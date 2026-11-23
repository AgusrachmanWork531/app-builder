import type { AppSpecification } from '@aab/agent-core';
import { Prisma, type ProjectRequirement } from '@aab/database';
import { ConflictError } from '@aab/shared-types';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../infrastructure/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';
import {
  REQUIREMENT_ANALYZER,
  type RequirementAnalyzer,
  normalizePrompt,
} from './requirement-analyzer';

export const createRequirementSchema = z
  .object({ prompt: z.string().max(10_000) })
  .transform(({ prompt }) => ({ rawPrompt: prompt, prompt: normalizePrompt(prompt) }))
  .pipe(
    z.object({
      rawPrompt: z.string(),
      prompt: z.string().min(10, 'prompt must be at least 10 characters').max(5000),
    }),
  );
export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;

export interface RequirementDto {
  id: string;
  revision: number;
  rawPrompt: string;
  normalizedPrompt: string;
  specification: AppSpecification;
  analyzer: string;
  createdAt: Date;
}

function toDto(row: ProjectRequirement): RequirementDto {
  return {
    id: row.id,
    revision: row.revision,
    rawPrompt: row.rawPrompt,
    normalizedPrompt: row.normalizedPrompt,
    specification: row.specification as AppSpecification,
    analyzer: row.analyzer,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    @Inject(REQUIREMENT_ANALYZER) private readonly analyzer: RequirementAnalyzer,
  ) {}

  /** Store a new requirement revision with its analyzed specification. */
  async create(
    userId: string,
    projectId: string,
    input: CreateRequirementInput,
  ): Promise<RequirementDto> {
    await this.access.getWritableProject(userId, projectId);
    const specification = await this.analyzer.analyze(input.prompt);
    const latest = await this.prisma.client.projectRequirement.findFirst({
      where: { projectId },
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });
    try {
      const row = await this.prisma.client.projectRequirement.create({
        data: {
          projectId,
          revision: (latest?.revision ?? 0) + 1,
          rawPrompt: input.rawPrompt,
          normalizedPrompt: input.prompt,
          specification,
          analyzer: this.analyzer.name,
          createdById: userId,
        },
      });
      return toDto(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('A concurrent requirement revision was created; retry');
      }
      throw error;
    }
  }

  async list(userId: string, projectId: string): Promise<RequirementDto[]> {
    await this.access.getOwnedProject(userId, projectId);
    const rows = await this.prisma.client.projectRequirement.findMany({
      where: { projectId },
      orderBy: { revision: 'desc' },
    });
    return rows.map(toDto);
  }
}
