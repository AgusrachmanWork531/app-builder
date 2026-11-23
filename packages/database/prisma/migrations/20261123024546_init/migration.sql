-- CreateEnum
CREATE TYPE "BuildStatus" AS ENUM ('PENDING', 'QUEUED', 'PLANNING', 'GENERATING', 'TESTING', 'REPAIRING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000),
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_requirements" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "raw_prompt" TEXT NOT NULL,
    "normalized_prompt" TEXT NOT NULL,
    "specification" JSONB NOT NULL,
    "analyzer" VARCHAR(64) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_jobs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "requirement_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "status" "BuildStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL,
    "repair_attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(128),
    "options" JSONB NOT NULL DEFAULT '{}',
    "current_step" VARCHAR(64),
    "error_code" VARCHAR(64),
    "error_message" TEXT,
    "error_details" JSONB,
    "worker_id" VARCHAR(128),
    "cancel_requested_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "last_heartbeat_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "build_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_job_events" (
    "id" UUID NOT NULL,
    "build_job_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "from_status" "BuildStatus",
    "to_status" "BuildStatus",
    "attempt" INTEGER NOT NULL,
    "step" VARCHAR(64),
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "build_job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_plans" (
    "id" UUID NOT NULL,
    "build_job_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "producer" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_tasks" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "title" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "output" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "execution_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_checkpoints" (
    "id" UUID NOT NULL,
    "build_job_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "step" VARCHAR(64) NOT NULL,
    "state" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_artifacts" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "build_job_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "path" VARCHAR(512) NOT NULL,
    "storage_key" VARCHAR(1024) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "content_type" VARCHAR(128) NOT NULL,
    "is_mock" BOOLEAN NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage_records" (
    "id" UUID NOT NULL,
    "build_job_id" UUID,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_usd" DECIMAL(12,6),
    "latency_ms" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "aggregate_type" VARCHAR(64) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "projects_owner_id_status_updated_at_idx" ON "projects"("owner_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "project_requirements_project_id_revision_key" ON "project_requirements"("project_id", "revision");

-- CreateIndex
CREATE INDEX "build_jobs_project_id_created_at_idx" ON "build_jobs"("project_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "build_jobs_status_updated_at_idx" ON "build_jobs"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "build_jobs_requested_by_id_idempotency_key_key" ON "build_jobs"("requested_by_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "build_job_events_build_job_id_sequence_key" ON "build_job_events"("build_job_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "build_job_events_build_job_id_dedupe_key_key" ON "build_job_events"("build_job_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "execution_plans_build_job_id_attempt_key" ON "execution_plans"("build_job_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "execution_tasks_plan_id_key_key" ON "execution_tasks"("plan_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "execution_tasks_plan_id_position_key" ON "execution_tasks"("plan_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_checkpoints_build_job_id_attempt_step_key" ON "workflow_checkpoints"("build_job_id", "attempt", "step");

-- CreateIndex
CREATE INDEX "project_artifacts_expires_at_idx" ON "project_artifacts"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_artifacts_build_job_id_attempt_path_key" ON "project_artifacts"("build_job_id", "attempt", "path");

-- CreateIndex
CREATE INDEX "llm_usage_records_build_job_id_idx" ON "llm_usage_records"("build_job_id");

-- CreateIndex
CREATE INDEX "llm_usage_records_created_at_idx" ON "llm_usage_records"("created_at");

-- CreateIndex
CREATE INDEX "outbox_messages_status_available_at_idx" ON "outbox_messages"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_messages_aggregate_id_idx" ON "outbox_messages"("aggregate_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_requirements" ADD CONSTRAINT "project_requirements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_requirements" ADD CONSTRAINT "project_requirements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "project_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_job_events" ADD CONSTRAINT "build_job_events_build_job_id_fkey" FOREIGN KEY ("build_job_id") REFERENCES "build_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_plans" ADD CONSTRAINT "execution_plans_build_job_id_fkey" FOREIGN KEY ("build_job_id") REFERENCES "build_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_tasks" ADD CONSTRAINT "execution_tasks_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "execution_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_checkpoints" ADD CONSTRAINT "workflow_checkpoints_build_job_id_fkey" FOREIGN KEY ("build_job_id") REFERENCES "build_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_artifacts" ADD CONSTRAINT "project_artifacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_artifacts" ADD CONSTRAINT "project_artifacts_build_job_id_fkey" FOREIGN KEY ("build_job_id") REFERENCES "build_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_usage_records" ADD CONSTRAINT "llm_usage_records_build_job_id_fkey" FOREIGN KEY ("build_job_id") REFERENCES "build_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
