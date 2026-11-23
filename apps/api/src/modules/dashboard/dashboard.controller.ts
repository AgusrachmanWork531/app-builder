import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/decorators';
import type { AuthUser } from '../../common/http/request';
import { type DashboardDto, DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Project count, recent projects/builds and build status summary' })
  get(@CurrentUser() user: AuthUser): Promise<DashboardDto> {
    return this.dashboard.forUser(user.id);
  }
}
