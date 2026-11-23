import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/http/request';
import type { GitCommitResult } from './git-provider';
import { GitExportService } from './git-export.service';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('builds/:buildId')
export class IntegrationsController {
  constructor(private readonly gitExport: GitExportService) {}

  @Post('git-export')
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Commit a COMPLETED build's artifacts to the project's platform-owned local git repository",
  })
  export(
    @CurrentUser() user: AuthUser,
    @Param('buildId', ParseUUIDPipe) buildId: string,
  ): Promise<GitCommitResult> {
    return this.gitExport.exportBuild(user.id, buildId);
  }
}
