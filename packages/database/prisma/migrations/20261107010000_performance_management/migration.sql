-- Performance management: review cycles, goals, appraisals and feedback notes.

CREATE TYPE "review_cycle_status" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');
CREATE TYPE "goal_status" AS ENUM ('ACTIVE', 'ACHIEVED', 'DROPPED');
CREATE TYPE "appraisal_status" AS ENUM ('AWAITING_SELF', 'AWAITING_MANAGER', 'COMPLETED', 'ACKNOWLEDGED');
CREATE TYPE "feedback_kind" AS ENUM ('PRAISE', 'SUGGESTION');

CREATE TABLE "review_cycle" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "status" "review_cycle_status" NOT NULL DEFAULT 'DRAFT',
    "opened_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_cycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "performance_goal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "status" "goal_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "performance_goal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "appraisal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reviewer_id" UUID,
    "status" "appraisal_status" NOT NULL DEFAULT 'AWAITING_SELF',
    "self_rating" INTEGER,
    "self_comment" TEXT,
    "self_submitted_at" TIMESTAMPTZ(6),
    "manager_rating" INTEGER,
    "manager_comment" TEXT,
    "reviewed_by_user_id" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appraisal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "feedback_note" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "to_id" UUID NOT NULL,
    "kind" "feedback_kind" NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_note_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_cycle_tenant_id_id_key" ON "review_cycle"("tenant_id", "id");
CREATE UNIQUE INDEX "review_cycle_tenant_id_company_id_name_key" ON "review_cycle"("tenant_id", "company_id", "name");
CREATE UNIQUE INDEX "performance_goal_tenant_id_id_key" ON "performance_goal"("tenant_id", "id");
CREATE INDEX "performance_goal_tenant_id_cycle_id_employee_id_idx" ON "performance_goal"("tenant_id", "cycle_id", "employee_id");
CREATE UNIQUE INDEX "appraisal_tenant_id_id_key" ON "appraisal"("tenant_id", "id");
CREATE UNIQUE INDEX "appraisal_tenant_id_cycle_id_employee_id_key" ON "appraisal"("tenant_id", "cycle_id", "employee_id");
CREATE INDEX "appraisal_tenant_id_reviewer_id_idx" ON "appraisal"("tenant_id", "reviewer_id");
CREATE INDEX "feedback_note_tenant_id_to_id_created_at_idx" ON "feedback_note"("tenant_id", "to_id", "created_at");
CREATE INDEX "feedback_note_tenant_id_from_id_created_at_idx" ON "feedback_note"("tenant_id", "from_id", "created_at");

ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_cycle" ADD CONSTRAINT "review_cycle_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_goal" ADD CONSTRAINT "performance_goal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_goal" ADD CONSTRAINT "performance_goal_tenant_id_cycle_id_fkey" FOREIGN KEY ("tenant_id", "cycle_id") REFERENCES "review_cycle"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_goal" ADD CONSTRAINT "performance_goal_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_tenant_id_cycle_id_fkey" FOREIGN KEY ("tenant_id", "cycle_id") REFERENCES "review_cycle"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_tenant_id_reviewer_id_fkey" FOREIGN KEY ("tenant_id", "reviewer_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_note" ADD CONSTRAINT "feedback_note_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_note" ADD CONSTRAINT "feedback_note_tenant_id_from_id_fkey" FOREIGN KEY ("tenant_id", "from_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_note" ADD CONSTRAINT "feedback_note_tenant_id_to_id_fkey" FOREIGN KEY ("tenant_id", "to_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
