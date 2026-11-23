-- AlterTable
ALTER TABLE "llm_usage_records" ADD COLUMN     "project_id" UUID,
ADD COLUMN     "purpose" VARCHAR(64) NOT NULL DEFAULT 'unspecified';

-- CreateIndex
CREATE INDEX "llm_usage_records_project_id_idx" ON "llm_usage_records"("project_id");

-- AddForeignKey
ALTER TABLE "llm_usage_records" ADD CONSTRAINT "llm_usage_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
