import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService, type ReadinessReport } from './health.service';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is running' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: PostgreSQL and Redis are reachable' })
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== 'ok') throw new ServiceUnavailableException(report);
    return report;
  }
}
