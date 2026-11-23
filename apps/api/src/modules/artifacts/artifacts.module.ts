import { LocalArtifactStore } from '@aab/sandbox-adapters';
import type { ApiEnv } from '@aab/shared-config';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ArtifactCleanupService } from './artifact-cleanup.service';
import { ArtifactsController } from './artifacts.controller';
import { ArtifactsService } from './artifacts.service';
import { ARTIFACT_STORE } from './artifacts.tokens';

/** Global so integrations can use the ArtifactStore without re-registering the module. */
@Global()
@Module({})
export class ArtifactsModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: ArtifactsModule,
      imports: [ProjectsModule],
      controllers: [ArtifactsController],
      providers: [
        {
          provide: ARTIFACT_STORE,
          useFactory: () => new LocalArtifactStore(env.ARTIFACT_STORAGE_PATH),
        },
        ArtifactsService,
        ArtifactCleanupService,
      ],
      exports: [ARTIFACT_STORE],
    };
  }
}
