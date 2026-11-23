import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/http/request';
import { RawResponse } from '../../common/http/response-envelope.interceptor';
import { ArtifactsService } from './artifacts.service';

/** Restrict download filenames to a safe character set for Content-Disposition. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'artifact';
}

@ApiTags('artifacts')
@ApiBearerAuth()
@Controller('builds/:buildId/artifacts')
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get(':artifactId/download')
  @RawResponse()
  @ApiProduces('application/octet-stream')
  @ApiOperation({
    summary: 'Download a build artifact (owner only; always served as an attachment)',
  })
  async download(
    @CurrentUser() user: AuthUser,
    @Param('buildId', ParseUUIDPipe) buildId: string,
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.artifacts.getForDownload(user.id, buildId, artifactId);
    // Generated content is untrusted: never render it inline in the browser.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(file.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Artifact-Sha256', file.sha256);
    res.setHeader('X-Artifact-Content-Type', file.contentType);
    res.status(200).end(file.content);
  }
}
