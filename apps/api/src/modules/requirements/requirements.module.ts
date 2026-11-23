import { Module } from '@nestjs/common';
import { LlmUsageService } from '../llm/llm-usage.service';
import { ProjectsModule } from '../projects/projects.module';
import { LlmRequirementAnalyzer } from './llm-requirement-analyzer';
import { MockRequirementAnalyzer } from './mock-requirement-analyzer';
import { REQUIREMENT_ANALYZER } from './requirement-analyzer';
import { RequirementsController } from './requirements.controller';
import { RequirementsService } from './requirements.service';

@Module({
  imports: [ProjectsModule],
  controllers: [RequirementsController],
  providers: [
    RequirementsService,
    {
      // LLM_PROVIDER=mock → deterministic template matcher; otherwise the
      // configured LLM (e.g. Midas deepseek-v4-pro) analyzes requirements.
      provide: REQUIREMENT_ANALYZER,
      inject: [LlmUsageService],
      useFactory: (llm: LlmUsageService) =>
        llm.providerInfo.isMock ? new MockRequirementAnalyzer() : new LlmRequirementAnalyzer(llm),
    },
  ],
})
export class RequirementsModule {}
