import { z } from 'zod';

/** Entity/field names end up in generated code: restrict to safe identifiers. */
const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'must be an identifier');

/**
 * Structured application specification produced by a RequirementAnalyzer and
 * consumed by agent runtimes. Persisted as JSON in project_requirements.
 */
export const appSpecificationSchema = z.object({
  schemaVersion: z.literal(1),
  // Single line: model-supplied names are interpolated into generated files.
  appName: z
    .string()
    .min(1)
    .max(120)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f]+$/, 'must be a single line without control characters'),
  summary: z.string().min(1).max(2000),
  entities: z
    .array(
      z.object({
        name: identifier,
        fields: z
          .array(
            z.object({
              name: identifier,
              type: z.enum(['string', 'text', 'number', 'boolean', 'datetime', 'reference']),
              required: z.boolean(),
            }),
          )
          .max(100),
      }),
    )
    .max(50),
  pages: z.array(z.string().min(1).max(64)).max(50),
  features: z.array(z.string().min(1).max(200)).max(100),
  /** Analyzer provenance. Mock analyzers never claim NL understanding. */
  analysis: z.object({
    analyzer: z.string().min(1).max(64),
    isMock: z.boolean(),
    matchedTemplate: z.string().nullable(),
    warnings: z.array(z.string()),
  }),
});

export type AppSpecification = z.infer<typeof appSpecificationSchema>;
