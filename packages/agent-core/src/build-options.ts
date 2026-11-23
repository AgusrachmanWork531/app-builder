import { z } from 'zod';

/**
 * Per-build options persisted on build_jobs.options.
 *
 * `simulateFailure` exists for mock mode only, to exercise the repair loop:
 *  - none:              validation passes
 *  - validation-once:   first validation fails, the repair round fixes it → COMPLETED
 *  - validation-always: every validation fails → REPAIRING until MAX_REPAIR_ATTEMPTS → FAILED
 */
export const buildOptionsSchema = z
  .object({
    simulateFailure: z.enum(['none', 'validation-once', 'validation-always']).default('none'),
  })
  .default({ simulateFailure: 'none' });

export type BuildOptions = z.infer<typeof buildOptionsSchema>;
