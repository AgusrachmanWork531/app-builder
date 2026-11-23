/**
 * Typed error categories shared by the control plane and the execution plane.
 *
 * Every error states whether it is retryable so queue processors and the
 * API can make consistent decisions. Messages must never contain secrets.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EXTERNAL_PROVIDER_ERROR'
  | 'RATE_LIMITED'
  | 'QUEUE_PROCESSING_ERROR'
  | 'SANDBOX_ERROR'
  | 'BUILD_FAILURE'
  | 'WORKFLOW_TRANSITION_ERROR'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'CANCELLED'
  | 'APPROVAL_REQUIRED'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

/** How a failure should be handled by retry/repair logic. */
export type FailureDisposition = 'retryable' | 'non_retryable' | 'cancelled' | 'approval_required';

export interface AppErrorOptions {
  retryable?: boolean;
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }

  get disposition(): FailureDisposition {
    if (this.code === 'CANCELLED') return 'cancelled';
    if (this.code === 'APPROVAL_REQUIRED') return 'approval_required';
    return this.retryable ? 'retryable' : 'non_retryable';
  }
}

type Opts = Omit<AppErrorOptions, 'retryable'>;

export class ValidationError extends AppError {
  constructor(message: string, options: Opts = {}) {
    super('VALIDATION_ERROR', message, options);
  }
}
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', options: Opts = {}) {
    super('AUTHENTICATION_ERROR', message, options);
  }
}
export class AuthorizationError extends AppError {
  constructor(message = 'Access denied', options: Opts = {}) {
    super('AUTHORIZATION_ERROR', message, options);
  }
}
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', options: Opts = {}) {
    super('NOT_FOUND', message, options);
  }
}
export class ConflictError extends AppError {
  constructor(message: string, options: Opts = {}) {
    super('CONFLICT', message, options);
  }
}
export class ExternalProviderError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('EXTERNAL_PROVIDER_ERROR', message, { retryable: true, ...options });
  }
}
export class RateLimitError extends AppError {
  readonly retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number, options: Opts = {}) {
    super('RATE_LIMITED', message, { ...options, retryable: true });
    this.retryAfterMs = retryAfterMs;
  }
}
export class QueueProcessingError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('QUEUE_PROCESSING_ERROR', message, { retryable: true, ...options });
  }
}
export class SandboxError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('SANDBOX_ERROR', message, options);
  }
}
export class BuildFailureError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('BUILD_FAILURE', message, options);
  }
}
export class WorkflowTransitionError extends AppError {
  constructor(message: string, options: Opts = {}) {
    super('WORKFLOW_TRANSITION_ERROR', message, options);
  }
}
export class ResourceLimitError extends AppError {
  constructor(message: string, options: Opts = {}) {
    super('RESOURCE_LIMIT_EXCEEDED', message, options);
  }
}
export class CancellationError extends AppError {
  constructor(message = 'Operation cancelled', options: Opts = {}) {
    super('CANCELLED', message, options);
  }
}
export class ApprovalRequiredError extends AppError {
  constructor(message: string, options: Opts = {}) {
    super('APPROVAL_REQUIRED', message, options);
  }
}
export class TimeoutError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('TIMEOUT', message, { retryable: true, ...options });
  }
}

/**
 * Classify any thrown value. Unknown errors are treated as non-retryable so a
 * programming bug never causes an unbounded retry storm.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : 'Unknown error';
  return new AppError('INTERNAL_ERROR', message, { retryable: false, cause: error });
}
