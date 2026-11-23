import type { BuildStatus } from '@aab/shared-types';

export type { BuildStatus };

/** Mock-mode switch to exercise the repair loop. */
export type SimulateFailure = 'none' | 'validation-once' | 'validation-always';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectListStatus = 'active' | 'archived' | 'all';

export interface Dashboard {
  projectCount: { active: number; archived: number };
  recentProjects: Project[];
  recentBuilds: (Build & { projectName: string })[];
  buildStatusSummary: Record<BuildStatus, number>;
}

export interface Requirement {
  id: string;
  revision: number;
  rawPrompt: string;
  normalizedPrompt: string;
  analyzer: string;
  createdAt: string;
  specification: {
    appName: string;
    summary: string;
    entities: { name: string }[];
    pages: string[];
    features: string[];
    analysis: {
      analyzer: string;
      isMock: boolean;
      matchedTemplate: string | null;
      warnings: string[];
    };
  };
}

export interface Build {
  id: string;
  projectId: string;
  requirementId: string;
  status: BuildStatus;
  attempt: number;
  maxAttempts: number;
  currentStep: string | null;
  repairAttempts: number;
  cancelRequested: boolean;
  options: { simulateFailure?: SimulateFailure };
  error: { code: string; message: string | null } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface BuildDetail extends Build {
  plan: {
    summary: string;
    producer: string;
    tasks: { key: string; title: string; status: string }[];
  } | null;
  artifacts: {
    id: string;
    path: string;
    sizeBytes: number;
    sha256: string;
    contentType: string;
    isMock: boolean;
    expiresAt: string | null;
  }[];
}

export interface BuildEvent {
  sequence: number;
  type: string;
  fromStatus: BuildStatus | null;
  toStatus: BuildStatus | null;
  attempt: number;
  step: string | null;
  message: string;
  createdAt: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
