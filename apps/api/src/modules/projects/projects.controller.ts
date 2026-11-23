import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/decorators';
import type { Paginated } from '../../common/http/paginated';
import type { AuthUser } from '../../common/http/request';
import { openApiSchema } from '../../common/validation/openapi';
import { ZodPipe } from '../../common/validation/zod.pipe';
import {
  type CreateProjectInput,
  type ListProjectsQuery,
  type ProjectDto,
  ProjectsService,
  type UpdateProjectInput,
  createProjectSchema,
  listProjectsQuerySchema,
  updateProjectSchema,
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
  @ApiOperation({ summary: 'List your projects (paginated; active by default)' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'archived', 'all'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(listProjectsQuerySchema)) query: ListProjectsQuery,
  ): Promise<Paginated<ProjectDto>> {
    return this.projects.list(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project you own' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ProjectDto> {
    return this.projects.get(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update project metadata (name, description)' })
  @ApiBody({ schema: openApiSchema(updateProjectSchema) })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateProjectSchema)) body: UpdateProjectInput,
  ): Promise<ProjectDto> {
    return this.projects.update(user.id, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a project (read-only; refused while builds are running)' })
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectDto> {
    return this.projects.archive(user.id, id);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore an archived project' })
  unarchive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectDto> {
    return this.projects.unarchive(user.id, id);
  }
}
