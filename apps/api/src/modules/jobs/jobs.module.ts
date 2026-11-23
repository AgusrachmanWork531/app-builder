import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { BuildQueue } from './build-queue';
import { BuildsController } from './builds.controller';
import { BuildsService } from './builds.service';
import { OutboxDispatcher } from './outbox-dispatcher.service';

@Module({
  imports: [ProjectsModule],
  controllers: [BuildsController],
  providers: [BuildsService, BuildQueue, OutboxDispatcher],
})
export class JobsModule {}
