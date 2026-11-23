import { RateLimitError } from '@aab/shared-types';
import { Injectable } from '@nestjs/common';

export const MAX_STREAMS_PER_USER = 5;
export const MAX_STREAMS_TOTAL = 200;

/**
 * Caps concurrent SSE streams (per user and per API instance) so one account
 * cannot exhaust the database pool by opening many long-lived streams.
 */
@Injectable()
export class StreamLimiter {
  private readonly perUser = new Map<string, number>();
  private total = 0;

  /** Reserve a slot; returns a release function that is safe to call more than once. */
  acquire(userId: string): () => void {
    const current = this.perUser.get(userId) ?? 0;
    if (current >= MAX_STREAMS_PER_USER) {
      throw new RateLimitError(`Too many open build streams (max ${MAX_STREAMS_PER_USER})`);
    }
    if (this.total >= MAX_STREAMS_TOTAL) {
      throw new RateLimitError('Server is at its live-stream capacity; retry shortly', 5000);
    }
    this.perUser.set(userId, current + 1);
    this.total++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const remaining = (this.perUser.get(userId) ?? 1) - 1;
      if (remaining <= 0) this.perUser.delete(userId);
      else this.perUser.set(userId, remaining);
    };
  }

  openStreams(userId?: string): number {
    return userId ? (this.perUser.get(userId) ?? 0) : this.total;
  }
}
