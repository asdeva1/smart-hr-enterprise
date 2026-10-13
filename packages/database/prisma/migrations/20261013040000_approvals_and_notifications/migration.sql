-- CreateEnum
CREATE TYPE "email_delivery_status" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "approval_task_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'CANCELLED');

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "email_status" "email_delivery_status" NOT NULL DEFAULT 'NOT_REQUESTED',
    "email_to" TEXT,
    "email_subject" TEXT,
    "email_text" TEXT,
    "email_attempts" INTEGER NOT NULL DEFAULT 0,
    "email_claimed_at" TIMESTAMPTZ(6),
    "email_sent_at" TIMESTAMPTZ(6),
    "email_last_error" TEXT,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("tenant_id","user_id","category")
);

-- CreateTable
CREATE TABLE "approval_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "definition" JSONB NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(19,4),
    "currency" CHAR(3),
    "scope_type" "scope_type" NOT NULL,
    "scope_id" UUID NOT NULL,
    "requested_by_membership_id" UUID NOT NULL,
    "status" "approval_status" NOT NULL DEFAULT 'PENDING',
    "current_stage" INTEGER NOT NULL DEFAULT 0,
    "round" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "stage" INTEGER NOT NULL,
    "stage_name" TEXT NOT NULL,
    "assignee_membership_id" UUID NOT NULL,
    "delegated_from_membership_id" UUID,
    "status" "approval_task_status" NOT NULL DEFAULT 'PENDING',
    "acted_by_membership_id" UUID,
    "acted_at" TIMESTAMPTZ(6),
    "comment" TEXT,
    "due_at" TIMESTAMPTZ(6),
    "escalated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_membership_id" UUID NOT NULL,
    "to_membership_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "approval_delegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_tenant_id_recipient_user_id_created_at_idx" ON "notification"("tenant_id", "recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_email_status_email_claimed_at_idx" ON "notification"("email_status", "email_claimed_at");

-- CreateIndex
CREATE UNIQUE INDEX "approval_policy_tenant_id_subject_type_version_key" ON "approval_policy"("tenant_id", "subject_type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "approval_policy_tenant_id_id_key" ON "approval_policy"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "approval_request_tenant_id_requested_by_membership_id_creat_idx" ON "approval_request"("tenant_id", "requested_by_membership_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_request_tenant_id_status_idx" ON "approval_request"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_request_tenant_id_subject_type_subject_id_key" ON "approval_request"("tenant_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_request_tenant_id_id_key" ON "approval_request"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "approval_task_tenant_id_assignee_membership_id_status_idx" ON "approval_task"("tenant_id", "assignee_membership_id", "status");

-- CreateIndex
CREATE INDEX "approval_task_tenant_id_request_id_idx" ON "approval_task"("tenant_id", "request_id");

-- CreateIndex
CREATE INDEX "approval_task_status_due_at_idx" ON "approval_task"("status", "due_at");

-- CreateIndex
CREATE INDEX "approval_delegation_tenant_id_from_membership_id_idx" ON "approval_delegation"("tenant_id", "from_membership_id");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_tenant_id_policy_id_fkey" FOREIGN KEY ("tenant_id", "policy_id") REFERENCES "approval_policy"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_tenant_id_requested_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "requested_by_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_task" ADD CONSTRAINT "approval_task_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "approval_request"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_task" ADD CONSTRAINT "approval_task_tenant_id_assignee_membership_id_fkey" FOREIGN KEY ("tenant_id", "assignee_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_tenant_id_from_membership_id_fkey" FOREIGN KEY ("tenant_id", "from_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_tenant_id_to_membership_id_fkey" FOREIGN KEY ("tenant_id", "to_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
