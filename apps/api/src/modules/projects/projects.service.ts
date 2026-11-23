import { CANCELLABLE_STATUSES } from '@aab/agent-core';
import type { Project } from '@aab/database';
import { ConflictError } from '@aab/shared-types';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  Paginated,
  type PaginationQuery,
  paginationQuerySchema,
  skipTake,
} from '../../common/http/paginated';
import { PrismaService } from '../../infrastructure/prisma.service';
import { ProjectAccessService } from './project-access.service';

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    /** null (or an empty string) clears the description. */
    description: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional()
      .transform((v) => (v === '' ? null : v)),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: 'Provide at least one of: name, description',
  });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['active', 'archived', 'all']).default('active'),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  status: Project['status'];
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toProjectDto(project: Project): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async create(userId: string, input: CreateProjectInput): Promise<ProjectDto> {
    const project = await this.prisma.client.project.create({
      data: { ownerId: userId, name: input.name, description: input.description ?? null },
    });
    return toProjectDto(project);
  }

  async list(userId: string, query: ListProjectsQuery): Promise<Paginated<ProjectDto>> {
    const where = {
      ownerId: userId,
      ...(query.status === 'all'
        ? {}
        : { status: query.status === 'archived' ? ('ARCHIVED' as const) : ('ACTIVE' as const) }),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.project.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        ...skipTake(query as PaginationQuery),
      }),
      this.prisma.client.project.count({ where }),
    ]);
    return Paginated.of(items.map(toProjectDto), total, query);
  }

  async get(userId: string, projectId: string): Promise<ProjectDto> {
    return toProjectDto(await this.access.getOwnedProject(userId, projectId));
  }

  /** Update metadata. Archived projects are read-only until unarchived. */
  async update(userId: string, projectId: string, input: UpdateProjectInput): Promise<ProjectDto> {
    const project = await this.prisma.client.$transaction(async (tx) => {
      await this.access.lockWritableProject(tx, userId, projectId);
      return tx.project.update({
        where: { id: projectId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
    });
    return toProjectDto(project);
  }

  /**
   * Archive (soft-delete) a project: hidden from the default list, read-only,
   * no new requirements or builds. Refused while a build is still running so
   * no work is orphaned; cancel it first.
   */
  async archive(userId: string, projectId: string): Promise<ProjectDto> {
    const project = await this.prisma.client.$transaction(async (tx) => {
      // Holding the project lock blocks concurrent build/requirement creation
      // and retries until this decision commits.
      const locked = await this.access.lockOwnedProject(tx, userId, projectId);
      if (locked.status === 'ARCHIVED') {
        return tx.project.findUniqueOrThrow({ where: { id: projectId } });
      }
      const running = await tx.buildJob.count({
        where: { projectId, status: { in: [...CANCELLABLE_STATUSES] } },
      });
      if (running > 0) {
        throw new ConflictError('Cancel or wait for running builds before archiving the project');
      }
      return tx.project.update({
        where: { id: projectId },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
    });
    return toProjectDto(project);
  }

  async unarchive(userId: string, projectId: string): Promise<ProjectDto> {
    const project = await this.prisma.client.$transaction(async (tx) => {
      const locked = await this.access.lockOwnedProject(tx, userId, projectId);
      if (locked.status === 'ACTIVE') {
        return tx.project.findUniqueOrThrow({ where: { id: projectId } });
      }
      return tx.project.update({
        where: { id: projectId },
        data: { status: 'ACTIVE', archivedAt: null },
      });
    });
    return toProjectDto(project);
  }
}
