import type { Project } from '@aab/database';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Paginated, type PaginationQuery, skipTake } from '../../common/http/paginated';
import { PrismaService } from '../../infrastructure/prisma.service';
import { ProjectAccessService } from './project-access.service';

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  status: Project['status'];
  createdAt: Date;
  updatedAt: Date;
}

export function toProjectDto(project: Project): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
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

  async list(userId: string, query: PaginationQuery): Promise<Paginated<ProjectDto>> {
    const where = { ownerId: userId, status: 'ACTIVE' as const };
    const [items, total] = await Promise.all([
      this.prisma.client.project.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.project.count({ where }),
    ]);
    return Paginated.of(items.map(toProjectDto), total, query);
  }

  async get(userId: string, projectId: string): Promise<ProjectDto> {
    return toProjectDto(await this.access.getOwnedProject(userId, projectId));
  }
}
