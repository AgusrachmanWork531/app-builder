import { z } from 'zod';

/**
 * Structured application specification produced by a RequirementAnalyzer and
 * consumed by agent runtimes. Persisted as JSON in project_requirements.
 */
export const appSpecificationSchema = z.object({
  schemaVersion: z.literal(1),
  appName: z.string().min(1).max(120),
  summary: z.string().min(1).max(2000),
  entities: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        fields: z.array(
          z.object({
            name: z.string().min(1).max(64),
            type: z.enum(['string', 'text', 'number', 'boolean', 'datetime', 'reference']),
            required: z.boolean(),
          }),
        ),
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
