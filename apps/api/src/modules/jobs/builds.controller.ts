import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/auth/decorators';
import {
  type Paginated,
  type PaginationQuery,
  paginationQuerySchema,
} from '../../common/http/paginated';
import { type AppRequest, type AuthUser, requestIdOf } from '../../common/http/request';
import { openApiSchema } from '../../common/validation/openapi';
import { ZodPipe } from '../../common/validation/zod.pipe';
import {
  type BuildDetailDto,
  type BuildDto,
  type BuildEventDto,
  BuildsService,
  type CreateBuildInput,
  type EventsQuery,
  createBuildSchema,
  eventsQuerySchema,
  idempotencyKeySchema,
} from './builds.service';

const idempotencyKeyPipe = new ZodPipe(idempotencyKeySchema);

@ApiTags('builds')
@ApiBearerAuth()
@Controller()
export class BuildsController {
  constructor(private readonly builds: BuildsService) {}

  @Post('projects/:id/builds')
  @HttpCode(202)
  @ApiOperation({ summary: 'Start a build asynchronously (202 + initial persisted status)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiBody({ schema: openApiSchema(createBuildSchema), required: false })
  async create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Body(new ZodPipe(createBuildSchema)) body: CreateBuildInput,
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BuildDto> {
    const idempotencyKey = idempotencyKeyPipe.transform(rawIdempotencyKey);
    const { build, created } = await this.builds.create(
      user.id,
      projectId,
      body,
      idempotencyKey,
      requestIdOf(req),
    );
    if (!created) res.setHeader('Idempotent-Replayed', 'true');
    res.setHeader('Location', `/api/v1/builds/${build.id}`);
    return build;
  }

  @Get('projects/:id/builds')
  @ApiOperation({ summary: 'List builds for a project (newest first, paginated)' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Query(new ZodPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Paginated<BuildDto>> {
    return this.builds.listForProject(user.id, projectId, query);
  }

  @Get('builds/:buildId')
  @ApiOperation({ summary: 'Build detail with plan and artifacts of the current attempt' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('buildId', ParseUUIDPipe) buildId: string,
  ): Promise<BuildDetailDto> {
    return this.builds.get(user.id, buildId);
  }

  @Get('builds/:buildId/events')
  @ApiOperation({ summary: 'Build event history ordered by sequence' })
  events(
    @CurrentUser() user: AuthUser,
    @Param('buildId', ParseUUIDPipe) buildId: string,
    @Query(new ZodPipe(eventsQuerySchema)) query: EventsQuery,
  ): Promise<BuildEventDto[]> {
    return this.builds.events(user.id, buildId, query);
  }
}
