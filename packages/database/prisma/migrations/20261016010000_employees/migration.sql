-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('ACTIVE', 'ON_NOTICE', 'EXITED');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('FEMALE', 'MALE', 'NON_BINARY', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "employee_event_kind" AS ENUM ('JOINED', 'TRANSFER', 'PROMOTION', 'MANAGER_CHANGE', 'NOTICE', 'NOTICE_WITHDRAWN', 'EXIT');

-- CreateTable
CREATE TABLE "employee" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_code" TEXT NOT NULL,
    "membership_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "preferred_name" TEXT,
    "work_email" TEXT,
    "personal_email" TEXT,
    "phone" TEXT,
    "date_of_birth" DATE,
    "gender" "gender",
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "department_id" UUID,
    "designation_id" UUID,
    "grade_id" UUID,
    "employment_type_id" UUID,
    "cost_centre_id" UUID,
    "manager_id" UUID,
    "date_of_joining" DATE NOT NULL,
    "probation_end_date" DATE,
    "status" "employee_status" NOT NULL DEFAULT 'ACTIVE',
    "notice_given_on" DATE,
    "last_working_day" DATE,
    "exit_reason_id" UUID,
    "exited_on" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_sensitive" (
    "employee_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pan_sealed" TEXT,
    "pan_last4" TEXT,
    "aadhaar_sealed" TEXT,
    "aadhaar_last4" TEXT,
    "bank_account_sealed" TEXT,
    "bank_account_last4" TEXT,
    "bank_ifsc" TEXT,
    "bank_name" TEXT,
    "uan" TEXT,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_sensitive_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "employee_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" "employee_event_kind" NOT NULL,
    "effective_date" DATE NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contact" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "emergency_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_counter" (
    "tenant_id" UUID NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employee_counter_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "employee_tenant_id_status_idx" ON "employee"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "employee_tenant_id_company_id_idx" ON "employee"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "employee_tenant_id_branch_id_idx" ON "employee"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "employee_tenant_id_department_id_idx" ON "employee"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "employee_tenant_id_manager_id_idx" ON "employee"("tenant_id", "manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tenant_id_id_key" ON "employee"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tenant_id_employee_code_key" ON "employee"("tenant_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tenant_id_membership_id_key" ON "employee"("tenant_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tenant_id_work_email_key" ON "employee"("tenant_id", "work_email");

-- CreateIndex
CREATE UNIQUE INDEX "employee_sensitive_tenant_id_employee_id_key" ON "employee_sensitive"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_event_tenant_id_employee_id_effective_date_idx" ON "employee_event"("tenant_id", "employee_id", "effective_date");

-- CreateIndex
CREATE INDEX "emergency_contact_tenant_id_employee_id_idx" ON "emergency_contact"("tenant_id", "employee_id");

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_department_id_fkey" FOREIGN KEY ("tenant_id", "department_id") REFERENCES "department"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_designation_id_fkey" FOREIGN KEY ("tenant_id", "designation_id") REFERENCES "lookup_value"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_grade_id_fkey" FOREIGN KEY ("tenant_id", "grade_id") REFERENCES "lookup_value"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_employment_type_id_fkey" FOREIGN KEY ("tenant_id", "employment_type_id") REFERENCES "lookup_value"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_cost_centre_id_fkey" FOREIGN KEY ("tenant_id", "cost_centre_id") REFERENCES "lookup_value"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_manager_id_fkey" FOREIGN KEY ("tenant_id", "manager_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_exit_reason_id_fkey" FOREIGN KEY ("tenant_id", "exit_reason_id") REFERENCES "lookup_value"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_sensitive" ADD CONSTRAINT "employee_sensitive_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_event" ADD CONSTRAINT "employee_event_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contact" ADD CONSTRAINT "emergency_contact_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
