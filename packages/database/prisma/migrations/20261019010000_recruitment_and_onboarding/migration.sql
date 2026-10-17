-- CreateEnum
CREATE TYPE "job_opening_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "application_stage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "interview_status" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "interview_recommendation" AS ENUM ('STRONG_YES', 'YES', 'NO', 'STRONG_NO');

-- CreateEnum
CREATE TYPE "job_offer_status" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "onboarding_assignee" AS ENUM ('HR', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "onboarding_plan_status" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "onboarding_task_status" AS ENUM ('OPEN', 'DONE', 'SKIPPED');

-- CreateTable
CREATE TABLE "job_opening" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "department_id" UUID,
    "designation_id" UUID,
    "employment_type_id" UUID,
    "hiring_manager_id" UUID,
    "positions" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "status" "job_opening_status" NOT NULL DEFAULT 'DRAFT',
    "approval_request_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_opening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "source" TEXT,
    "resume_file_id" UUID,
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_application" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opening_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "stage" "application_stage" NOT NULL DEFAULT 'APPLIED',
    "closed_reason" TEXT,
    "hired_employee_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_stage" "application_stage",
    "to_stage" "application_stage" NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "location" TEXT,
    "status" "interview_status" NOT NULL DEFAULT 'SCHEDULED',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_feedback" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "interview_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rating" INTEGER,
    "recommendation" "interview_recommendation",
    "comments" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "interview_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "designation_id" UUID,
    "joining_date" DATE NOT NULL,
    "annual_ctc" DECIMAL(14,2),
    "currency" CHAR(3),
    "notes" TEXT,
    "status" "job_offer_status" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approval_request_id" UUID,
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "responded_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "document_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "onboarding_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_template_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee" "onboarding_assignee" NOT NULL,
    "due_offset_days" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "onboarding_template_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_plan" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "template_name" TEXT,
    "start_date" DATE NOT NULL,
    "status" "onboarding_plan_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "onboarding_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee" "onboarding_assignee" NOT NULL,
    "assignee_user_id" UUID,
    "due_date" DATE NOT NULL,
    "status" "onboarding_task_status" NOT NULL DEFAULT 'OPEN',
    "completed_at" TIMESTAMPTZ(6),
    "completed_by_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "onboarding_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_opening_tenant_id_status_idx" ON "job_opening"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_opening_tenant_id_id_key" ON "job_opening"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_opening_tenant_id_code_key" ON "job_opening"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_tenant_id_id_key" ON "candidate"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_tenant_id_email_key" ON "candidate"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "job_application_tenant_id_opening_id_stage_idx" ON "job_application"("tenant_id", "opening_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "job_application_tenant_id_id_key" ON "job_application"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_application_opening_id_candidate_id_key" ON "job_application"("opening_id", "candidate_id");

-- CreateIndex
CREATE INDEX "application_event_tenant_id_application_id_idx" ON "application_event"("tenant_id", "application_id");

-- CreateIndex
CREATE INDEX "interview_tenant_id_application_id_idx" ON "interview"("tenant_id", "application_id");

-- CreateIndex
CREATE UNIQUE INDEX "interview_tenant_id_id_key" ON "interview"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "interview_feedback_tenant_id_user_id_idx" ON "interview_feedback"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "interview_feedback_interview_id_membership_id_key" ON "interview_feedback"("interview_id", "membership_id");

-- CreateIndex
CREATE INDEX "job_offer_tenant_id_application_id_idx" ON "job_offer"("tenant_id", "application_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_offer_tenant_id_id_key" ON "job_offer"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_template_tenant_id_id_key" ON "onboarding_template"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_template_tenant_id_name_key" ON "onboarding_template"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_template_task_template_id_position_key" ON "onboarding_template_task"("template_id", "position");

-- CreateIndex
CREATE INDEX "onboarding_plan_tenant_id_employee_id_idx" ON "onboarding_plan"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_plan_tenant_id_id_key" ON "onboarding_plan"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "onboarding_task_tenant_id_assignee_user_id_status_idx" ON "onboarding_task"("tenant_id", "assignee_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_task_plan_id_position_key" ON "onboarding_task"("plan_id", "position");

-- AddForeignKey
ALTER TABLE "job_opening" ADD CONSTRAINT "job_opening_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_opening" ADD CONSTRAINT "job_opening_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate" ADD CONSTRAINT "candidate_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_tenant_id_opening_id_fkey" FOREIGN KEY ("tenant_id", "opening_id") REFERENCES "job_opening"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_tenant_id_candidate_id_fkey" FOREIGN KEY ("tenant_id", "candidate_id") REFERENCES "candidate"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_application" ADD CONSTRAINT "job_application_tenant_id_hired_employee_id_fkey" FOREIGN KEY ("tenant_id", "hired_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_event" ADD CONSTRAINT "application_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_event" ADD CONSTRAINT "application_event_tenant_id_application_id_fkey" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "job_application"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview" ADD CONSTRAINT "interview_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview" ADD CONSTRAINT "interview_tenant_id_application_id_fkey" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "job_application"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_tenant_id_interview_id_fkey" FOREIGN KEY ("tenant_id", "interview_id") REFERENCES "interview"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_offer" ADD CONSTRAINT "job_offer_tenant_id_application_id_fkey" FOREIGN KEY ("tenant_id", "application_id") REFERENCES "job_application"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template" ADD CONSTRAINT "onboarding_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template_task" ADD CONSTRAINT "onboarding_template_task_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template_task" ADD CONSTRAINT "onboarding_template_task_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "onboarding_template"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_plan" ADD CONSTRAINT "onboarding_plan_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_plan" ADD CONSTRAINT "onboarding_plan_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_task" ADD CONSTRAINT "onboarding_task_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_task" ADD CONSTRAINT "onboarding_task_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "onboarding_plan"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
