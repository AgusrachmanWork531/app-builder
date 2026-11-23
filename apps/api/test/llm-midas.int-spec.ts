import { type IncomingMessage, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, createTestApp } from './support/test-app';

/**
 * End-to-end through the real API with LLM_PROVIDER=midas, against a local
 * fake OpenAI-compatible gateway (no network, no real credentials or tokens).
 */
let gateway: Server;
let t: TestApp;
let token: string;
const received: { auth?: string; body: { model: string; messages: { content: string }[] } }[] = [];
let nextStatus = 200;

const specReply = {
  appName: 'Recipe Hub',
  summary: 'Share and discover recipes.',
  entities: [
    {
      name: 'Recipe',
      fields: [
        { name: 'title', type: 'string', required: true },
        { name: 'servings', type: 'number', required: false },
      ],
    },
  ],
  pages: ['RecipeList', 'RecipeDetail'],
  features: ['Publish recipes', 'Rate recipes'],
};

async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

beforeAll(async () => {
  gateway = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    received.push({ auth: req.headers.authorization, body });
    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    if (nextStatus !== 200) {
      res.writeHead(nextStatus, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(JSON.stringify({ error: { message: 'slow down' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: JSON.stringify(specReply) } }],
        usage: { prompt_tokens: 321, completion_tokens: 123 },
      }),
    );
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const { port } = gateway.address() as AddressInfo;

  t = await createTestApp({
    LLM_PROVIDER: 'midas',
    LLM_MODEL: '',
    MIDAS_BASE_URL: `http://127.0.0.1:${port}/v1`,
    MIDAS_API_KEY: 'test-midas-key',
    LLM_REQUESTS_PER_USER_PER_MINUTE: '3',
  });
  const user = await t.createUser();
  token = await t.login(user.email, user.password);
});

afterAll(async () => {
  await t?.close();
  await new Promise((resolve) => gateway?.close(resolve));
});

describe('requirement analysis via Midas (deepseek-v4-pro)', () => {
  it('analyzes the prompt with the gateway and records token usage', async () => {
    const project = await t
      .http()
      .post('/api/v1/projects')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: 'Recipes' });
    const projectId = project.body.data.id as string;

    const res = await t
      .http()
      .post(`/api/v1/projects/${projectId}/requirements`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ prompt: 'A community site where home cooks share and rate recipes' })
      .expect(201);

    expect(res.body.data).toMatchObject({
      analyzer: 'midas:deepseek-v4-pro',
      specification: {
        appName: 'Recipe Hub',
        analysis: { isMock: false, analyzer: 'midas:deepseek-v4-pro' },
      },
    });

    const call = received.at(-1)!;
    expect(call.auth).toBe('Bearer test-midas-key');
    expect(call.body.model).toBe('deepseek-v4-pro');
    expect(call.body.messages[1]?.content).toContain('home cooks share and rate recipes');

    const usage = await t.prisma.llmUsageRecord.findMany({ where: { projectId } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      provider: 'midas',
      model: 'deepseek-v4-pro',
      purpose: 'requirement-analysis',
      inputTokens: 321,
      outputTokens: 123,
      success: true,
    });
  });

  it('maps a gateway rate limit to 429 and records the failed call', async () => {
    const project = await t
      .http()
      .post('/api/v1/projects')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: 'Limited' });
    const projectId = project.body.data.id as string;
    nextStatus = 429;
    try {
      const res = await t
        .http()
        .post(`/api/v1/projects/${projectId}/requirements`)
        .set({ Authorization: `Bearer ${token}` })
        .send({ prompt: 'A todo app for a small team' })
        .expect(429);
      expect(res.body.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
      expect(JSON.stringify(res.body)).not.toContain('test-midas-key');
      const usage = await t.prisma.llmUsageRecord.findMany({ where: { projectId } });
      expect(usage[0]).toMatchObject({ success: false, errorCode: 'RATE_LIMITED' });
      expect(await t.prisma.projectRequirement.count({ where: { projectId } })).toBe(0);
    } finally {
      nextStatus = 200;
    }
  });
});

describe('paid LLM abuse guard', () => {
  it('limits requirement analyses per user per minute', async () => {
    const user = await t.createUser();
    const userToken = await t.login(user.email, user.password);
    const project = await t
      .http()
      .post('/api/v1/projects')
      .set({ Authorization: `Bearer ${userToken}` })
      .send({ name: 'Throttled' });
    const projectId = project.body.data.id as string;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await t
        .http()
        .post(`/api/v1/projects/${projectId}/requirements`)
        .set({ Authorization: `Bearer ${userToken}` })
        .send({ prompt: `A recipe site variant ${i} for cooks` });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
  });
});
