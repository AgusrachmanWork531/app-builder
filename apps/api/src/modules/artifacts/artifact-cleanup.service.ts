import type { ArtifactStore } from '@aab/agent-core';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma.service';
import { ARTIFACT_STORE } from './artifacts.tokens';

const CLEANUP_INTERVAL_MS = 60 * 60_000;
const BATCH = 200;
const MAX_BATCHES_PER_RUN = 100;

/**
 * Deletes expired artifacts: file first, then the metadata row, so a crash
 * in between leaves a row whose file is already gone (harmless; the next pass
 * removes it) rather than an orphaned file nobody tracks.
 */
@Injectable()
export class ArtifactCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ArtifactCleanupService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ARTIFACT_STORE) private readonly store: ArtifactStore,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.cleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async cleanup(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let removed = 0;
    try {
      // Drain in batches until done (bounded per pass), oldest expiry first.
      for (let pass = 0; pass < MAX_BATCHES_PER_RUN; pass++) {
        const expired = await this.prisma.client.projectArtifact.findMany({
          where: { expiresAt: { lte: now } },
          orderBy: { expiresAt: 'asc' },
          select: { id: true, storageKey: true },
          take: BATCH,
        });
        const deletable: string[] = [];
        for (const artifact of expired) {
          try {
            await this.store.delete(artifact.storageKey);
            deletable.push(artifact.id);
          } catch (error) {
            this.logger.warn(
              { err: error, artifactId: artifact.id },
              'failed to remove artifact file',
            );
          }
        }
        // deleteMany is idempotent if another instance removed the same rows.
        const { count } = await this.prisma.client.projectArtifact.deleteMany({
          where: { id: { in: deletable } },
        });
        removed += count;
        if (expired.length < BATCH || deletable.length === 0) break;
      }
      if (removed > 0) this.logger.log(`removed ${removed} expired artifact(s)`);
      return removed;
    } finally {
      this.running = false;
    }
  }
}
