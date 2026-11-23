import { ValidationError } from '@aab/shared-types';
import { type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Validates and parses a request part with a Zod schema; 400 on failure. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError('Request validation failed', {
        details: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
