import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';
import type { HealthService, ReadinessReport } from './health.service';

function controllerWith(report: ReadinessReport): HealthController {
  const service = { readiness: async () => report } as unknown as HealthService;
  return new HealthController(service);
}

describe('HealthController', () => {
  it('reports liveness without touching dependencies', () => {
    expect(
      controllerWith({ status: 'error', checks: { database: 'down', redis: 'down' } }).live(),
    ).toEqual({ status: 'ok' });
  });

  it('returns the report when all dependencies are up', async () => {
    const report: ReadinessReport = { status: 'ok', checks: { database: 'up', redis: 'up' } };
    await expect(controllerWith(report).ready()).resolves.toEqual(report);
  });

  it('responds 503 when a dependency is down', async () => {
    const report: ReadinessReport = { status: 'error', checks: { database: 'up', redis: 'down' } };
    await expect(controllerWith(report).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
