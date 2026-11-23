import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/http/request';
import { openApiSchema } from '../../common/validation/openapi';
import { ZodPipe } from '../../common/validation/zod.pipe';
import {
  type CreateRequirementInput,
  type RequirementDto,
  RequirementsService,
  createRequirementSchema,
} from './requirements.service';

@ApiTags('requirements')
@ApiBearerAuth()
@Controller('projects/:id/requirements')
export class RequirementsController {
  constructor(private readonly requirements: RequirementsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a requirement prompt (stored as a new revision)' })
  @ApiBody({ schema: openApiSchema(createRequirementSchema) })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) projectId: string,
    @Body(new ZodPipe(createRequirementSchema)) body: CreateRequirementInput,
  ): Promise<RequirementDto> {
    return this.requirements.create(user.id, projectId, body);
  }

  @Get()
  @ApiOperation({ summary: 'List requirement revisions (newest first)' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) projectId: string,
  ): Promise<RequirementDto[]> {
    return this.requirements.list(user.id, projectId);
  }
}
