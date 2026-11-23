import type { BuildStatus } from '@aab/shared-types';

export type { BuildStatus };

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
  createdAt: string;
  updatedAt: string;
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
    path: string;
    sizeBytes: number;
    sha256: string;
    contentType: string;
    isMock: boolean;
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
