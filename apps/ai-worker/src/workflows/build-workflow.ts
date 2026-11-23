import {
  type AgentContext,
  type AgentRuntime,
  type ExecutionPlanDraft,
  type SandboxProvider,
  type SandboxWorkspace,
  appSpecificationSchema,
} from '@aab/agent-core';
import {
  type PrismaClient,
  type TransitionResult,
  appendEvent,
  transitionBuild,
} from '@aab/database';
import { type BuildJobPayload, buildQueueJobId } from '@aab/job-contracts';
import { type Logger, withContext } from '@aab/logger';
import {
  BuildFailureError,
  type BuildStatus,
  NotFoundError,
  ValidationError,
  isTerminalBuildStatus,
} from '@aab/shared-types';
import { buildTimeoutError } from '../agents/mock-agent-runtime';
import { isUniqueViolation } from '../recovery/classify-error';

export interface BuildWorkflowDeps {
  prisma: PrismaClient;
  runtime: AgentRuntime;
  sandbox: SandboxProvider;
  logger: Logger;
  workerId: string;
  buildTimeoutSeconds: number;
}

export type WorkflowOutcome =
  | { outcome: 'completed'; artifacts: number }
  | { outcome: 'skipped'; reason: string; status: BuildStatus };

/** Raised internally when persisted state says this delivery must stop (e.g. cancelled). */
export class WorkflowInterrupted extends Error {
  constructor(readonly status: BuildStatus) {
    super(`workflow interrupted: build is ${status}`);
  }
}

const STEP_ORDER: BuildStatus[] = ['QUEUED', 'PLANNING', 'GENERATING', 'TESTING', 'COMPLETED'];

/**
 * Executes one attempt of a build. PostgreSQL is authoritative: every step
 * re-reads persisted status, so duplicate or stale queue deliveries resume or
 * no-op instead of corrupting state. Step side effects are idempotent (plan
 * and artifacts are unique per attempt; files are deterministic).
 */
export class BuildWorkflow {
  constructor(private readonly deps: BuildWorkflowDeps) {}

  async run(payload: BuildJobPayload): Promise<WorkflowOutcome> {
    const { prisma } = this.deps;
    const build = await prisma.buildJob.findUnique({
      where: { id: payload.buildJobId },
      include: { requirement: { select: { specification: true } } },
    });
    if (!build) throw new NotFoundError(`Build job ${payload.buildJobId} not found`);
    if (build.attempt !== payload.attempt) {
      return { outcome: 'skipped', reason: 'stale attempt', status: build.status };
    }
    if (isTerminalBuildStatus(build.status)) {
      return { outcome: 'skipped', reason: 'already terminal', status: build.status };
    }

    const parsedSpec = appSpecificationSchema.safeParse(build.requirement.specification);
    if (!parsedSpec.success) {
      throw new ValidationError('Stored requirement specification is invalid', {
        details: parsedSpec.error.issues,
      });
    }

    const logger = withContext(this.deps.logger, {
      buildId: build.id,
      projectId: build.projectId,
      correlationId: payload.correlationId,
    });
    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(buildTimeoutError(this.deps.buildTimeoutSeconds)),
      this.deps.buildTimeoutSeconds * 1000,
    );
    const context: AgentContext = {
      buildJobId: build.id,
      projectId: build.projectId,
      attempt: build.attempt,
      specification: parsedSpec.data,
      signal: timeout.signal,
    };

    try {
      let status = build.status;
      if (status === 'PENDING')
        status = await this.enter(context, status, 'QUEUED', 'Picked up by worker');

      const workspace = await this.deps.sandbox.createWorkspace(
        buildQueueJobId(build.id, build.attempt),
      );

      status = await this.enter(context, status, 'PLANNING', 'Planning build');
      const plan = await this.planStep(context, logger);

      status = await this.enter(context, status, 'GENERATING', 'Generating artifacts');
      const artifacts = await this.generateStep(context, plan, workspace, logger);

      status = await this.enter(context, status, 'TESTING', 'Validating artifacts');
      await this.validateStep(context, plan, workspace);

      await this.enter(context, status, 'COMPLETED', 'Build completed (mock)', {
        artifacts,
        isMock: this.deps.runtime.isMock || this.deps.sandbox.isMock,
      });
      logger.info({ status: 'COMPLETED', artifacts }, 'build completed');
      return { outcome: 'completed', artifacts };
    } catch (error) {
      if (error instanceof WorkflowInterrupted) {
        logger.info({ status: error.status }, 'workflow stopped by persisted state');
        return { outcome: 'skipped', reason: 'interrupted', status: error.status };
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Move to `target` unless persisted state is already at/after it (resume
   * after redelivery). Stops the workflow if the build left the active path.
   */
  private async enter(
    context: AgentContext,
    current: BuildStatus,
    target: BuildStatus,
    message: string,
    metadata: Record<string, string | number | boolean> = {},
  ): Promise<BuildStatus> {
    if (STEP_ORDER.indexOf(current) >= STEP_ORDER.indexOf(target)) return current;
    const result: TransitionResult = await transitionBuild(this.deps.prisma, {
      buildJobId: context.buildJobId,
      to: target,
      attempt: context.attempt,
      expectedFrom: [current],
      message,
      step: target,
      metadata,
      workerId: this.deps.workerId,
      dedupeKey: `a${context.attempt}:${target}`,
    });
    if (!result.applied) {
      if (isTerminalBuildStatus(result.current) || result.reason === 'stale_attempt') {
        throw new WorkflowInterrupted(result.current);
      }
      // Another delivery advanced the build concurrently; continue from there.
      return result.current;
    }
    await this.deps.prisma.buildJob.update({
      where: { id: context.buildJobId },
      data: { lastHeartbeatAt: new Date() },
    });
    return target;
  }

  private async loadPlan(context: AgentContext): Promise<ExecutionPlanDraft | undefined> {
    const existing = await this.deps.prisma.executionPlan.findUnique({
      where: { buildJobId_attempt: { buildJobId: context.buildJobId, attempt: context.attempt } },
      include: { tasks: { orderBy: { position: 'asc' } } },
    });
    return existing
      ? {
          summary: existing.summary,
          tasks: existing.tasks.map((t) => ({ key: t.key, title: t.title })),
        }
      : undefined;
  }

  /**
   * Get-or-create the plan for this attempt. Safe under redelivery and under
   * two concurrent deliveries (a lost create race re-reads the winner's plan).
   * The checkpoint and PLAN_CREATED event are idempotent, so they are always
   * (re)written — a crash after the plan insert cannot lose them.
   */
  private async planStep(context: AgentContext, logger: Logger): Promise<ExecutionPlanDraft> {
    const { prisma, runtime } = this.deps;
    const started = Date.now();
    let plan = await this.loadPlan(context);
    if (!plan) {
      const draft = await runtime.plan(context);
      try {
        await prisma.executionPlan.create({
          data: {
            buildJobId: context.buildJobId,
            attempt: context.attempt,
            summary: draft.summary,
            producer: runtime.name,
            tasks: {
              create: draft.tasks.map((task, position) => ({
                position,
                key: task.key,
                title: task.title,
              })),
            },
          },
        });
        plan = draft;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        plan = await this.loadPlan(context);
        if (!plan) throw error;
      }
    }
    await this.checkpoint(context, 'PLANNING', { tasks: plan.tasks.length });
    await appendEvent(prisma, {
      buildJobId: context.buildJobId,
      attempt: context.attempt,
      type: 'PLAN_CREATED',
      step: 'PLANNING',
      message: plan.summary,
      metadata: { tasks: plan.tasks.map((t) => t.key), isMock: runtime.isMock },
      dedupeKey: `a${context.attempt}:plan`,
    });
    logger.info({ executionStep: 'PLANNING', durationMs: Date.now() - started }, 'plan persisted');
    return plan;
  }

  private async generateStep(
    context: AgentContext,
    plan: ExecutionPlanDraft,
    workspace: SandboxWorkspace,
    logger: Logger,
  ): Promise<number> {
    const { prisma, runtime, sandbox } = this.deps;
    const files = await runtime.generate(context, plan, workspace);
    const planRow = await prisma.executionPlan.findUniqueOrThrow({
      where: { buildJobId_attempt: { buildJobId: context.buildJobId, attempt: context.attempt } },
    });
    const filesByTask = new Map<string, string[]>();
    for (const file of files) {
      filesByTask.set(file.taskKey, [...(filesByTask.get(file.taskKey) ?? []), file.path]);
    }
    const now = new Date();
    for (const [key, paths] of filesByTask) {
      await prisma.executionTask.updateMany({
        where: { planId: planRow.id, key },
        data: {
          status: 'COMPLETED',
          output: { files: paths, isMock: runtime.isMock },
          completedAt: now,
        },
      });
    }

    const collected = await workspace.collectArtifacts();
    await prisma.projectArtifact.createMany({
      data: collected.map((artifact) => ({
        projectId: context.projectId,
        buildJobId: context.buildJobId,
        attempt: context.attempt,
        path: artifact.path,
        storageKey: artifact.storageKey,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        contentType: artifact.contentType,
        isMock: runtime.isMock || sandbox.isMock,
      })),
      skipDuplicates: true,
    });
    await this.checkpoint(context, 'GENERATING', { artifacts: collected.length });
    await appendEvent(prisma, {
      buildJobId: context.buildJobId,
      attempt: context.attempt,
      type: 'ARTIFACTS_GENERATED',
      step: 'GENERATING',
      message: `Generated ${collected.length} mock artifacts`,
      metadata: { paths: collected.map((a) => a.path), isMock: true },
      dedupeKey: `a${context.attempt}:artifacts`,
    });
    logger.info(
      { executionStep: 'GENERATING', artifacts: collected.length },
      'artifacts persisted',
    );
    return collected.length;
  }

  private async validateStep(
    context: AgentContext,
    plan: ExecutionPlanDraft,
    workspace: SandboxWorkspace,
  ): Promise<void> {
    const { prisma, runtime } = this.deps;
    const report = await runtime.validate(context, plan, workspace);
    await appendEvent(prisma, {
      buildJobId: context.buildJobId,
      attempt: context.attempt,
      type: 'VALIDATION_REPORT',
      step: 'TESTING',
      message: report.passed
        ? `Validation passed (${report.checks} checks)`
        : `Validation failed: ${report.issues.length} issue(s)`,
      metadata: {
        passed: report.passed,
        checks: report.checks,
        issues: report.issues.map((i) => i.message),
      },
      dedupeKey: `a${context.attempt}:validation`,
    });
    const planRow = await prisma.executionPlan.findUniqueOrThrow({
      where: { buildJobId_attempt: { buildJobId: context.buildJobId, attempt: context.attempt } },
    });
    await prisma.executionTask.updateMany({
      where: { planId: planRow.id, key: 'validation' },
      data: {
        status: report.passed ? 'COMPLETED' : 'FAILED',
        output: { checks: report.checks, issues: report.issues.length },
        completedAt: new Date(),
      },
    });
    await this.checkpoint(context, 'TESTING', { passed: report.passed });
    if (!report.passed) {
      throw new BuildFailureError('Generated artifacts failed validation', {
        details: { issues: report.issues.map((i) => i.message) },
      });
    }
  }

  private async checkpoint(
    context: AgentContext,
    step: string,
    state: Record<string, string | number | boolean>,
  ): Promise<void> {
    await this.deps.prisma.workflowCheckpoint.upsert({
      where: {
        buildJobId_attempt_step: { buildJobId: context.buildJobId, attempt: context.attempt, step },
      },
      create: { buildJobId: context.buildJobId, attempt: context.attempt, step, state },
      update: { state },
    });
  }
}
