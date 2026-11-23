import { type AppSpecification, appSpecificationSchema } from '@aab/agent-core';
import { Injectable } from '@nestjs/common';
import type { RequirementAnalyzer } from './requirement-analyzer';

type Template = Omit<AppSpecification, 'schemaVersion' | 'analysis'> & {
  key: string;
  match: RegExp;
};

const TEMPLATES: Template[] = [
  {
    key: 'task-manager',
    match: /\b(todo|to-do|tasks?|checklist)\b/i,
    appName: 'Task Manager',
    summary: 'Create, track and complete tasks with due dates and priorities.',
    entities: [
      {
        name: 'Task',
        fields: [
          { name: 'title', type: 'string', required: true },
          { name: 'description', type: 'text', required: false },
          { name: 'done', type: 'boolean', required: true },
          { name: 'dueAt', type: 'datetime', required: false },
        ],
      },
    ],
    pages: ['TaskList', 'TaskDetail', 'NewTask'],
    features: ['Create tasks', 'Mark tasks done', 'Filter by status'],
  },
  {
    key: 'blog',
    match: /\b(blog|posts?|articles?)\b/i,
    appName: 'Blog',
    summary: 'Publish posts and collect comments.',
    entities: [
      {
        name: 'Post',
        fields: [
          { name: 'title', type: 'string', required: true },
          { name: 'body', type: 'text', required: true },
          { name: 'publishedAt', type: 'datetime', required: false },
        ],
      },
      {
        name: 'Comment',
        fields: [
          { name: 'post', type: 'reference', required: true },
          { name: 'body', type: 'text', required: true },
        ],
      },
    ],
    pages: ['PostList', 'PostDetail', 'Editor'],
    features: ['Write posts', 'Publish posts', 'Comment on posts'],
  },
  {
    key: 'inventory',
    match: /\b(inventory|stock|warehouse|products?)\b/i,
    appName: 'Inventory Tracker',
    summary: 'Track products and stock levels across locations.',
    entities: [
      {
        name: 'Product',
        fields: [
          { name: 'sku', type: 'string', required: true },
          { name: 'name', type: 'string', required: true },
          { name: 'quantity', type: 'number', required: true },
        ],
      },
    ],
    pages: ['ProductList', 'ProductDetail'],
    features: ['Add products', 'Adjust stock', 'Low-stock report'],
  },
];

const GENERIC: Omit<Template, 'key' | 'match'> = {
  appName: 'Generic App',
  summary: 'Generic CRUD application (prompt did not match a supported mock template).',
  entities: [
    {
      name: 'Item',
      fields: [
        { name: 'name', type: 'string', required: true },
        { name: 'notes', type: 'text', required: false },
      ],
    },
  ],
  pages: ['ItemList', 'ItemDetail'],
  features: ['Create items', 'Edit items'],
};

/**
 * MOCK analyzer: deterministic keyword-to-template matching. It does NOT
 * understand natural language; unmatched prompts yield a generic spec with an
 * explicit warning. Replace with an LLM-backed analyzer behind the same
 * RequirementAnalyzer interface.
 */
@Injectable()
export class MockRequirementAnalyzer implements RequirementAnalyzer {
  readonly name = 'mock';

  async analyze(normalizedPrompt: string): Promise<AppSpecification> {
    const template = TEMPLATES.find((t) => t.match.test(normalizedPrompt));
    const base = template ?? GENERIC;
    return appSpecificationSchema.parse({
      schemaVersion: 1,
      appName: base.appName,
      summary: base.summary,
      entities: base.entities,
      pages: base.pages,
      features: base.features,
      analysis: {
        analyzer: this.name,
        isMock: true,
        matchedTemplate: template?.key ?? null,
        warnings: template
          ? ['Specification produced by the deterministic mock analyzer from a fixed template.']
          : [
              'Prompt did not match a supported mock template (todo/tasks, blog, inventory); a generic specification was produced. The mock analyzer does not understand natural language.',
            ],
      },
    });
  }
}
