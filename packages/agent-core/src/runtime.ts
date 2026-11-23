import type { AppSpecification } from './app-specification';
import type { BuildOptions } from './build-options';

/**
 * Execution-plane contracts. A single AgentRuntime implements the three agent
 * roles for now; they are separate interfaces so real provider-backed agents
 * can be introduced per role later without changing the workflow runner.
 */

export interface PlannedTask {
  key: string;
  title: string;
}

export interface ExecutionPlanDraft {
  summary: string;
  tasks: PlannedTask[];
}

export interface AgentContext {
  buildJobId: string;
  projectId: string;
  attempt: number;
  specification: AppSpecification;
  options: BuildOptions;
  /** Number of repair rounds already performed in this attempt. */
  repairRound: number;
  /** Aborted when the build is cancelled or times out. */
  signal: AbortSignal;
}

export interface PlanningAgent {
  plan(context: AgentContext): Promise<ExecutionPlanDraft>;
}

export interface GeneratedFile {
  /** Path relative to the workspace root. */
  path: string;
  taskKey: string;
}

export interface CodingAgent {
  generate(
    context: AgentContext,
    plan: ExecutionPlanDraft,
    workspace: SandboxWorkspace,
  ): Promise<GeneratedFile[]>;
}

export interface ValidationIssue {
  path?: string;
  message: string;
}

export interface ValidationReport {
  passed: boolean;
  checks: number;
  issues: ValidationIssue[];
}

export interface ValidationAgent {
  validate(
    context: AgentContext,
    plan: ExecutionPlanDraft,
    workspace: SandboxWorkspace,
  ): Promise<ValidationReport>;
}

export interface RepairAgent {
  /** Attempt to fix the issues in a failed validation report. */
  repair(
    context: AgentContext,
    plan: ExecutionPlanDraft,
    report: ValidationReport,
    workspace: SandboxWorkspace,
  ): Promise<GeneratedFile[]>;
}

export interface AgentRuntime extends PlanningAgent, CodingAgent, ValidationAgent, RepairAgent {
  readonly name: string;
  /** True for deterministic mock runtimes; surfaced on every persisted result. */
  readonly isMock: boolean;
}

// ---------------------------------------------------------------- sandbox

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CollectedArtifact {
  path: string;
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
}

/**
 * An isolated per-build workspace. Paths are always relative to the
 * workspace root; implementations must reject traversal outside it.
 */
export interface SandboxWorkspace {
  readonly id: string;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  listFiles(): Promise<string[]>;
  executeCommand(
    command: string,
    args: string[],
    options?: { timeoutMs?: number },
  ): Promise<CommandResult>;
  collectArtifacts(): Promise<CollectedArtifact[]>;
  /** Stop any running processes in the workspace. */
  terminate(): Promise<void>;
  /** Remove transient workspace state; collected artifacts remain addressable. */
  cleanup(): Promise<void>;
}

export interface SandboxProvider {
  readonly name: string;
  readonly isMock: boolean;
  /** Idempotent: re-creating the same workspace id returns the existing workspace. */
  createWorkspace(workspaceId: string): Promise<SandboxWorkspace>;
}
