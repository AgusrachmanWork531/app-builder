import {
  type AgentContext,
  type AgentRuntime,
  CANCELLABLE_STATUSES,
  type ExecutionPlanDraft,
  type SandboxProvider,
  type SandboxWorkspace,
  type ValidationReport,
  appSpecificationSchema,
  buildOptionsSchema,
} from '@aab/agent-core';
import {
  type PrismaClient,
  type TransitionResult,
  appendEvent,
  transitionBuild,
  transitionLocked,
} from '@aab/database';
import { type BuildJobPayload, buildQueueJobId } from '@aab/job-contracts';
import { type Logger, withContext } from '@aab/logger';
import {
  BuildFailureError,
  type BuildStatus,
  CancellationError,
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
  maxRepairAttempts: number;
  /** Collected artifacts expire after this many days (cleaned up by the API). */
  artifactRetentionDays: number;
  /** How often to poll for cancellation and refresh the heartbeat. */
  controlPollMs?: number;
}

export type WorkflowOutcome =
  | { outcome: 'completed'; artifacts: number }
  | { outcome: 'cancelled' }
  | { outcome: 'skipped'; reason: string; status: BuildStatus };

/** Raised internally when persisted state says this delivery must stop. */
export class WorkflowInterrupted extends Error {
  constructor(readonly status: BuildStatus) {
    super(`workflow interrupted: build is ${status}`);
  }
}

/** Progress rank; REPAIRING sits at the TESTING stage of the pipeline. */
const RANK: Partial<Record<BuildStatus, number>> = {
  PENDING: 0,
  QUEUED: 1,
  PLANNING: 2,
  GENERATING: 3,
  TESTING: 4,
  REPAIRING: 4,
  COMPLETED: 5,
};

const DEFAULT_CONTROL_POLL_MS = 500;

/**
 * Decide what to do when a forward transition was not applied because another
 * writer changed the build first. Typical benign race: the worker read PENDING
 * before the outbox dispatcher committed PENDING → QUEUED. Continue from the
 * persisted status while it is still on the pipeline path; stop only when the
 * build is terminal, belongs to a newer attempt, or left the path (approval).
 */
export function resolveUnappliedTransition(
  result: Extract<TransitionResult, { applied: false }>,
): BuildStatus | 'interrupt' {
  if (result.reason === 'stale_attempt') return 'interrupt';
  if (isTerminalBuildStatus(result.current)) return 'interrupt';
  return RANK[result.current] === undefined ? 'interrupt' : result.current;
}

/**
 * Executes one attempt of a build. PostgreSQL is authoritative: every step
 * re-reads persisted status, so duplicate or stale queue deliveries resume or
 * no-op instead of corrupting state. Step side effects are idempotent (plan
 * and artifacts are unique per attempt; files are deterministic).
 *
 * Cancellation is cooperative: the API records cancel_requested_at, a control
 * loop here aborts the in-flight step, and the worker persists CANCELLED.
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
    const options = buildOptionsSchema.parse(build.options ?? {});

    const logger = withContext(this.deps.logger, {
      buildId: build.id,
      projectId: build.projectId,
      correlationId: payload.correlationId,
    });
    const abort = new AbortController();
    const timer = setTimeout(
      () => abort.abort(buildTimeoutError(this.deps.buildTimeoutSeconds)),
      this.deps.buildTimeoutSeconds * 1000,
    );
    const control = this.startControlLoop(build.id, build.attempt, abort);
    const context: AgentContext = {
      buildJobId: build.id,
      projectId: build.projectId,
      attempt: build.attempt,
      specification: parsedSpec.data,
      options,
      repairRound: build.repairAttempts,
      signal: abort.signal,
    };

    let workspace: SandboxWorkspace | undefined;
    try {
      if (build.cancelRequestedAt) throw new CancellationError('Cancelled by user');
      let status = build.status;
      if (status === 'PENDING') {
        status = await this.enter(context, status, 'QUEUED', 'Picked up by worker');
      }

      workspace = await this.deps.sandbox.createWorkspace(buildQueueJobId(build.id, build.attempt));

      status = await this.enter(context, status, 'PLANNING', 'Planning build');
      const plan = await this.planStep(context, logger);

      status = await this.enter(context, status, 'GENERATING', 'Generating artifacts');
      const artifacts = await this.generateStep(context, plan, workspace, logger);

      status = await this.enter(context, status, 'TESTING', 'Validating artifacts');
      status = await this.testAndRepair(context, status, plan, workspace, logger);

      await this.assertNotCancelled(context);
      await this.enter(context, status, 'COMPLETED', 'Build completed (mock)', {
        artifacts,
        repairRounds: context.repairRound,
        isMock: this.deps.runtime.isMock || this.deps.sandbox.isMock,
      });
      logger.info({ status: 'COMPLETED', artifacts }, 'build completed');
      return { outcome: 'completed', artifacts };
    } catch (error) {
      if (error instanceof WorkflowInterrupted) {
        logger.info({ status: error.status }, 'workflow stopped by persisted state');
        return { outcome: 'skipped', reason: 'interrupted', status: error.status };
      }
      if (error instanceof CancellationError) {
        await this.persistCancellation(context);
        logger.info({ status: 'CANCELLED' }, 'build cancelled');
        return { outcome: 'cancelled' };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      clearInterval(control);
      await workspace?.terminate();
    }
  }

  /**
   * Poll persisted control state: refresh the heartbeat and abort the
   * in-flight step when cancellation was requested.
   */
  private startControlLoop(buildJobId: string, attempt: number, abort: AbortController) {
    const timer = setInterval(() => {
      void this.deps.prisma.buildJob
        .update({
          where: { id: buildJobId },
          data: { lastHeartbeatAt: new Date() },
          select: { cancelRequestedAt: true, status: true, attempt: true },
        })
        .then((row) => {
          if (row.attempt !== attempt) abort.abort(new WorkflowInterrupted(row.status));
          else if (row.cancelRequestedAt || row.status === 'CANCELLED') {
            abort.abort(new CancellationError('Cancelled by user'));
          }
        })
        .catch((error: unknown) => {
          // Transient DB errors here are tolerated; the next tick retries.
          this.deps.logger.warn({ err: error, buildId: buildJobId }, 'control loop poll failed');
        });
    }, this.deps.controlPollMs ?? DEFAULT_CONTROL_POLL_MS);
    timer.unref();
    return timer;
  }

  private async persistCancellation(context: AgentContext): Promise<void> {
    await transitionBuild(this.deps.prisma, {
      buildJobId: context.buildJobId,
      to: 'CANCELLED',
      attempt: context.attempt,
      expectedFrom: [...CANCELLABLE_STATUSES],
      message: 'Build cancelled',
      dedupeKey: `a${context.attempt}:CANCELLED`,
    });
  }

  /**
   * Validate; on failure run bounded repair rounds (TESTING → REPAIRING →
   * TESTING). Resumes correctly if redelivered while REPAIRING.
   */
  private async testAndRepair(
    context: AgentContext,
    initial: BuildStatus,
    plan: ExecutionPlanDraft,
    workspace: SandboxWorkspace,
    logger: Logger,
  ): Promise<BuildStatus> {
    let status = initial;
    for (;;) {
      let report: ValidationReport | undefined;
      let round: number;
      if (status !== 'REPAIRING') {
        report = await this.validateStep(context, plan, workspace);
        if (report.passed) return status;
        if (context.repairRound >= this.deps.maxRepairAttempts) {
          throw new BuildFailureError(
            `Validation still failing after ${context.repairRound} repair round(s)`,
            { details: { issues: report.issues.map((i) => i.message) } },
          );
        }
        round = context.repairRound + 1;
        await this.enterRepair(context, round);
      } else {
        // Redelivered mid-repair: the round was recorded atomically with the
        // TESTING → REPAIRING transition, so resume that same round.
        round = Math.max(context.repairRound, 1);
      }
      const files = await this.deps.runtime.repair(
        context,
        plan,
        report ?? { passed: false, checks: 0, issues: [] },
        workspace,
      );
      context.repairRound = round;
      await this.checkpoint(context, `REPAIRING-${round}`, { files: files.length });
      logger.info({ executionStep: 'REPAIRING', round }, 'repair round finished');
      status = await this.transitionStep(
        context,
        'REPAIRING',
        'TESTING',
        'Re-validating after repair',
        {
          round,
        },
      );
    }
  }

  /** TESTING → REPAIRING and the repair counter in one transaction (crash-consistent). */
  private async enterRepair(context: AgentContext, round: number): Promise<void> {
    context.signal.throwIfAborted();
    const applied = await this.deps.prisma.$transaction(async (tx) => {
      const result = await transitionLocked(tx, {
        buildJobId: context.buildJobId,
        to: 'REPAIRING',
        attempt: context.attempt,
        expectedFrom: ['TESTING'],
        message: 'Repairing artifacts',
        step: 'REPAIRING',
        metadata: { round },
        workerId: this.deps.workerId,
        dedupeKey: `a${context.attempt}:REPAIRING:r${round}`,
      });
      if (!result.applied) return result;
      await tx.buildJob.update({
        where: { id: context.buildJobId },
        data: { repairAttempts: round },
      });
      return result;
    });
    if (!applied.applied) throw new WorkflowInterrupted(applied.current);
  }

  /**
   * A cancel can be requested between the worker's last control poll and the
   * final transition; re-check right before COMPLETED so it is honoured.
   */
  private async assertNotCancelled(context: AgentContext): Promise<void> {
    const row = await this.deps.prisma.buildJob.findUnique({
      where: { id: context.buildJobId },
      select: { cancelRequestedAt: true },
    });
    if (row?.cancelRequestedAt) throw new CancellationError('Cancelled by user');
  }

  /** Explicit transition between two known states, deduplicated per repair round. */
  private async transitionStep(
    context: AgentContext,
    from: BuildStatus,
    to: BuildStatus,
    message: string,
    metadata: { round: number },
  ): Promise<BuildStatus> {
    context.signal.throwIfAborted();
    const result = await transitionBuild(this.deps.prisma, {
      buildJobId: context.buildJobId,
      to,
      attempt: context.attempt,
      expectedFrom: [from],
      message,
      step: to,
      metadata,
      workerId: this.deps.workerId,
      dedupeKey: `a${context.attempt}:${to}:r${metadata.round}`,
    });
    if (!result.applied) throw new WorkflowInterrupted(result.current);
    return to;
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
    context.signal.throwIfAborted();
    if ((RANK[current] ?? -1) >= (RANK[target] ?? Infinity)) return current;
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
      const next = resolveUnappliedTransition(result);
      if (next === 'interrupt') throw new WorkflowInterrupted(result.current);
      return next;
    }
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
    const expiresAt = new Date(Date.now() + this.deps.artifactRetentionDays * 86_400_000);
    await prisma.projectArtifact.createMany({
      data: collected.map((artifact) => ({
        expiresAt,
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
  ): Promise<ValidationReport> {
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
        round: context.repairRound,
        issues: report.issues.map((i) => i.message),
      },
      dedupeKey: `a${context.attempt}:validation:r${context.repairRound}`,
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
    await this.checkpoint(context, 'TESTING', {
      passed: report.passed,
      round: context.repairRound,
    });
    return report;
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
