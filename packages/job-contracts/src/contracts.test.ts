import { describe, expect, it } from 'vitest';
import { buildQueueJobId, parseBuildJobPayload } from './index';

const valid = {
  schemaVersion: 1,
  buildJobId: '7d0c8a3e-6a8f-4f53-9d38-3d1c9f0b6c11',
  projectId: '1b4e28ba-2fa1-4d2b-a5c4-6f2a0b3c4d5e',
  attempt: 1,
  correlationId: 'req-123',
  enqueuedAt: new Date().toISOString(),
};

describe('build job contract', () => {
  it('accepts a valid v1 payload', () => {
    expect(parseBuildJobPayload(valid)).toEqual(valid);
  });

  it('rejects unknown schema versions', () => {
    expect(() => parseBuildJobPayload({ ...valid, schemaVersion: 2 })).toThrow();
  });

  it('rejects non-uuid identifiers', () => {
    expect(() => parseBuildJobPayload({ ...valid, buildJobId: '1; DROP TABLE' })).toThrow();
  });

  it('produces a deterministic per-attempt job id without colons', () => {
    const id = buildQueueJobId(valid.buildJobId, 2);
    expect(id).toBe(`${valid.buildJobId}_a2`);
    expect(id).not.toContain(':');
  });
});
