-- DropForeignKey
ALTER TABLE "build_jobs" DROP CONSTRAINT "build_jobs_requested_by_id_fkey";

-- DropForeignKey
ALTER TABLE "build_jobs" DROP CONSTRAINT "build_jobs_requirement_id_fkey";

-- DropForeignKey
ALTER TABLE "project_requirements" DROP CONSTRAINT "project_requirements_created_by_id_fkey";

-- AlterTable
ALTER TABLE "build_jobs" ALTER COLUMN "requested_by_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "project_requirements" ALTER COLUMN "created_by_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "project_requirements" ADD CONSTRAINT "project_requirements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "project_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
