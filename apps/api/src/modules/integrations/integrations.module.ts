import type { ApiEnv } from '@aab/shared-config';
import { type DynamicModule, Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { GIT_PROVIDER } from './git-provider';
import { GitExportService } from './git-export.service';
import { IntegrationsController } from './integrations.controller';
import { LocalGitProvider } from './local-git.provider';

@Module({})
export class IntegrationsModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: IntegrationsModule,
      imports: [ProjectsModule],
      controllers: [IntegrationsController],
      providers: [
        {
          provide: GIT_PROVIDER,
          useFactory: () => new LocalGitProvider(env.ARTIFACT_STORAGE_PATH),
        },
        GitExportService,
      ],
    };
  }
}
