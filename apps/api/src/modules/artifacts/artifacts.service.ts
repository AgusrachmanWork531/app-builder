import type { ArtifactStore } from '@aab/agent-core';
import type { ProjectArtifact } from '@aab/database';
import { NotFoundError } from '@aab/shared-types';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { ARTIFACT_STORE } from './artifacts.tokens';

export interface ArtifactDownload {
  filename: string;
  contentType: string;
  sha256: string;
  content: Buffer;
}

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    @Inject(ARTIFACT_STORE) private readonly store: ArtifactStore,
  ) {}

  /** Owner-checked artifact lookup; expired artifacts are treated as gone. */
  async getForDownload(
    userId: string,
    buildJobId: string,
    artifactId: string,
  ): Promise<ArtifactDownload> {
    await this.access.assertBuildAccess(userId, buildJobId);
    const artifact: ProjectArtifact | null = await this.prisma.client.projectArtifact.findFirst({
      where: { id: artifactId, buildJobId },
    });
    if (!artifact) throw new NotFoundError('Artifact not found');
    if (artifact.expiresAt && artifact.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundError('Artifact has expired');
    }
    const content = await this.store.read(artifact.storageKey);
    return {
      filename: artifact.path.split('/').pop() ?? 'artifact',
      contentType: artifact.contentType,
      sha256: artifact.sha256,
      content,
    };
  }
}
