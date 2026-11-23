import type { Project } from '@aab/database';
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
