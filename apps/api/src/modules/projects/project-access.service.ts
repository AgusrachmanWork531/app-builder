import type { Prisma, Project } from '@aab/database';
import { ConflictError, NotFoundError } from '@aab/shared-types';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma.service';

/**
 * Centralized project authorization. Every project-scoped operation (projects,
 * requirements, builds, events, streams, artifacts) resolves access here.
 *
 * Non-owners get 404, not 403, so project existence is not disclosed.
 */
@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwnedProject(userId: string, projectId: string): Promise<Project> {
    const project = await this.prisma.client.project.findFirst({
      where: { id: projectId, ownerId: userId },
    });
    if (!project) throw new NotFoundError('Project not found');
    return project;
  }

  async getWritableProject(userId: string, projectId: string): Promise<Project> {
    const project = await this.getOwnedProject(userId, projectId);
    if (project.status === 'ARCHIVED') throw new ConflictError('Project is archived');
    return project;
  }

  /**
   * Lock the project row (FOR UPDATE) inside the caller's transaction and
   * assert ownership. Every write that depends on the project's status
   * (archive, update, new requirement/build/retry) takes this lock first, so
   * an archive can never interleave with a concurrent write. Lock order is
   * always project → build, which rules out deadlocks with build-level locks.
   */
  async lockOwnedProject(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string,
  ): Promise<{ id: string; status: Project['status'] }> {
    const rows = await tx.$queryRaw<{ id: string; status: Project['status'] }[]>`
      SELECT id, status::text AS status FROM projects
      WHERE id = ${projectId}::uuid AND owner_id = ${userId}::uuid
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new NotFoundError('Project not found');
    return row;
  }

  /** As lockOwnedProject, and reject archived (read-only) projects. */
  async lockWritableProject(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string,
  ): Promise<void> {
    const row = await this.lockOwnedProject(tx, userId, projectId);
    if (row.status === 'ARCHIVED') throw new ConflictError('Project is archived');
  }

  /** Resolve a build through its project's ownership. */
  async assertBuildAccess(userId: string, buildJobId: string): Promise<{ projectId: string }> {
    const build = await this.prisma.client.buildJob.findFirst({
      where: { id: buildJobId, project: { ownerId: userId } },
      select: { projectId: true },
    });
    if (!build) throw new NotFoundError('Build not found');
    return build;
  }
}
