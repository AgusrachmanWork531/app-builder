import { BUILD_STATUSES } from '@aab/shared-types';
import { describe, expect, it } from 'vitest';
import { BuildStatus } from './generated/prisma/enums';

describe('Prisma schema', () => {
  it('keeps the BuildStatus enum in sync with @aab/shared-types', () => {
    expect(Object.values(BuildStatus).sort()).toEqual([...BUILD_STATUSES].sort());
  });
});
