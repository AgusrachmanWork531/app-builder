import { RateLimitError } from '@aab/shared-types';
import { describe, expect, it } from 'vitest';
import { publicMetadata } from './builds.service';
import { MAX_STREAMS_PER_USER, StreamLimiter } from './stream-limiter';

describe('StreamLimiter', () => {
  it('caps concurrent streams per user and frees slots on release', () => {
    const limiter = new StreamLimiter();
    const releases = Array.from({ length: MAX_STREAMS_PER_USER }, () => limiter.acquire('u1'));
    expect(() => limiter.acquire('u1')).toThrow(RateLimitError);
    expect(() => limiter.acquire('u2')).not.toThrow();
    releases[0]!();
    releases[0]!(); // idempotent release
    expect(limiter.openStreams('u1')).toBe(MAX_STREAMS_PER_USER - 1);
    expect(() => limiter.acquire('u1')).not.toThrow();
  });
});

describe('publicMetadata', () => {
  it('keeps whitelisted keys and drops everything else', () => {
    expect(
      publicMetadata({ round: 1, issues: ['x'], stack: 'Error at /srv/app.js', hostPath: '/etc' }),
    ).toEqual({ round: 1, issues: ['x'] });
    expect(publicMetadata(null)).toEqual({});
    expect(publicMetadata(['a'])).toEqual({});
  });
});
