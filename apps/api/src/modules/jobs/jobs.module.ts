import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { BuildQueue } from './build-queue';
import { BuildReconciler } from './build-reconciler.service';
import { BuildStreamController } from './build-stream.controller';
import { BuildsController } from './builds.controller';
import { BuildsService } from './builds.service';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { StreamLimiter } from './stream-limiter';

@Module({
  imports: [ProjectsModule],
  controllers: [BuildsController, BuildStreamController],
  providers: [BuildsService, BuildQueue, OutboxDispatcher, BuildReconciler, StreamLimiter],
})
export class JobsModule {}
