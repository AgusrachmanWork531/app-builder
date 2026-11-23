import { BUILD_STATUSES, type BuildStatus } from '@aab/shared-types';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma.service';
import { type BuildDto, toBuildDto } from '../jobs/builds.service';
import { type ProjectDto, toProjectDto } from '../projects/projects.service';

export interface DashboardDto {
  projectCount: { active: number; archived: number };
  recentProjects: ProjectDto[];
  recentBuilds: (BuildDto & { projectName: string })[];
  /** Count of the user's builds per status (all statuses present, zero-filled). */
  buildStatusSummary: Record<BuildStatus, number>;
}

const RECENT_PROJECTS = 5;
const RECENT_BUILDS = 10;

/** Read model for the dashboard; every query is scoped to the requesting user. */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: string): Promise<DashboardDto> {
    const db = this.prisma.client;
    const ownBuilds = { project: { ownerId: userId } };
    const [active, archived, recentProjects, recentBuilds, grouped] = await Promise.all([
      db.project.count({ where: { ownerId: userId, status: 'ACTIVE' } }),
      db.project.count({ where: { ownerId: userId, status: 'ARCHIVED' } }),
      db.project.findMany({
        where: { ownerId: userId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        take: RECENT_PROJECTS,
      }),
      db.buildJob.findMany({
        where: ownBuilds,
        orderBy: { createdAt: 'desc' },
        take: RECENT_BUILDS,
        include: { project: { select: { name: true } } },
      }),
      db.buildJob.groupBy({ by: ['status'], where: ownBuilds, _count: { _all: true } }),
    ]);

    const buildStatusSummary = Object.fromEntries(BUILD_STATUSES.map((s) => [s, 0])) as Record<
      BuildStatus,
      number
    >;
    for (const row of grouped) buildStatusSummary[row.status] = row._count._all;

    return {
      projectCount: { active, archived },
      recentProjects: recentProjects.map(toProjectDto),
      recentBuilds: recentBuilds.map((b) => ({ ...toBuildDto(b), projectName: b.project.name })),
      buildStatusSummary,
    };
  }
}
