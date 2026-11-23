import type { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

type BodySchema = Extract<Parameters<typeof ApiBody>[0], { schema: unknown }>['schema'];

/** Derive an OpenAPI schema from the same Zod schema used for validation. */
export function openApiSchema(schema: z.ZodType): BodySchema {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as BodySchema;
}
