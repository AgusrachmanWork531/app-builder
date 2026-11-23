-- DropForeignKey
ALTER TABLE "build_jobs" DROP CONSTRAINT "build_jobs_requested_by_id_fkey";

-- DropForeignKey
ALTER TABLE "build_jobs" DROP CONSTRAINT "build_jobs_requirement_id_fkey";

-- DropForeignKey
ALTER TABLE "project_requirements" DROP CONSTRAINT "project_requirements_created_by_id_fkey";

-- CreateIndex
CREATE INDEX "build_jobs_requirement_id_idx" ON "build_jobs"("requirement_id");

-- CreateIndex
CREATE INDEX "project_artifacts_project_id_idx" ON "project_artifacts"("project_id");

-- CreateIndex
CREATE INDEX "project_requirements_created_by_id_idx" ON "project_requirements"("created_by_id");

-- AddForeignKey
ALTER TABLE "project_requirements" ADD CONSTRAINT "project_requirements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "project_requirements"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
