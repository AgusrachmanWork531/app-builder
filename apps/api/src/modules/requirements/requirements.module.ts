import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { MockRequirementAnalyzer } from './mock-requirement-analyzer';
import { REQUIREMENT_ANALYZER } from './requirement-analyzer';
import { RequirementsController } from './requirements.controller';
import { RequirementsService } from './requirements.service';

@Module({
  imports: [ProjectsModule],
  controllers: [RequirementsController],
  providers: [
    RequirementsService,
    { provide: REQUIREMENT_ANALYZER, useClass: MockRequirementAnalyzer },
  ],
})
export class RequirementsModule {}
