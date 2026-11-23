import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/decorators';
import {
  type Paginated,
  type PaginationQuery,
  paginationQuerySchema,
} from '../../common/http/paginated';
import type { AuthUser } from '../../common/http/request';
import { openApiSchema } from '../../common/validation/openapi';
import { ZodPipe } from '../../common/validation/zod.pipe';
import {
  type CreateProjectInput,
  type ProjectDto,
  ProjectsService,
  createProjectSchema,
} from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a project' })
  @ApiBody({ schema: openApiSchema(createProjectSchema) })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createProjectSchema)) body: CreateProjectInput,
  ): Promise<ProjectDto> {
    return this.projects.create(user.id, body);
  }

  @Get()
  @ApiOperation({ summary: 'List your active projects (paginated)' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Paginated<ProjectDto>> {
    return this.projects.list(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project you own' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ProjectDto> {
    return this.projects.get(user.id, id);
  }
}
