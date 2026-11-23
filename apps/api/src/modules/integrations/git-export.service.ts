import type { ArtifactStore } from '@aab/agent-core';
import { appendEvent } from '@aab/database';
import { ConflictError, NotFoundError } from '@aab/shared-types';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma.service';
import { ARTIFACT_STORE } from '../artifacts/artifacts.tokens';
import { ProjectAccessService } from '../projects/project-access.service';
import { GIT_PROVIDER, type GitCommitResult, type GitProvider } from './git-provider';

/** Exports a COMPLETED build's artifacts as a commit in the project's local repository. */
@Injectable()
export class GitExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    @Inject(ARTIFACT_STORE) private readonly store: ArtifactStore,
    @Inject(GIT_PROVIDER) private readonly git: GitProvider,
  ) {}

  async exportBuild(userId: string, buildJobId: string): Promise<GitCommitResult> {
    const { projectId } = await this.access.assertBuildAccess(userId, buildJobId);
    const build = await this.prisma.client.buildJob.findUniqueOrThrow({
      where: { id: buildJobId },
    });
    if (build.status !== 'COMPLETED') {
      throw new ConflictError('Only COMPLETED builds can be exported');
    }
    const artifacts = await this.prisma.client.projectArtifact.findMany({
      where: {
        buildJobId,
        attempt: build.attempt,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { path: 'asc' },
    });
    if (artifacts.length === 0) throw new NotFoundError('No unexpired artifacts to export');

    // Sequential reads bound memory/IO per export (artifacts are size-limited).
    const files: { path: string; content: Buffer }[] = [];
    for (const a of artifacts)
      files.push({ path: a.path, content: await this.store.read(a.storageKey) });

    const repository = `project-${projectId}`;
    const message = `Export build ${buildJobId} (attempt ${build.attempt})${artifacts.some((a) => a.isMock) ? ' [MOCK artifacts]' : ''}`;
    // A transaction-scoped Postgres advisory lock serializes exports of the same
    // repository across API instances (the provider's lock is per process).
    const result = await this.prisma.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`git:${repository}`}))`;
        return this.git.commitFiles(repository, files, message);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    await appendEvent(this.prisma.client, {
      buildJobId,
      attempt: build.attempt,
      type: 'GIT_EXPORTED',
      message: `Exported ${result.files} artifact(s) to ${result.repository}`,
      metadata: { repository: result.repository, commitSha: result.commitSha },
    });
    return result;
  }
}
