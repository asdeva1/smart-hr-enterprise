-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "attendance_day_status" ADD VALUE 'HOLIDAY';
ALTER TYPE "attendance_day_status" ADD VALUE 'ON_LEAVE';

-- CreateEnum
CREATE TYPE "leave_accrual" AS ENUM ('YEARLY', 'MONTHLY', 'NONE');

-- CreateEnum
CREATE TYPE "leave_ledger_kind" AS ENUM ('GRANT', 'ACCRUAL', 'CARRY_FORWARD', 'LAPSE', 'ADJUSTMENT', 'TAKEN', 'REVERSAL');

-- CreateEnum
CREATE TYPE "leave_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "half_day" AS ENUM ('FIRST_HALF', 'SECOND_HALF');

-- CreateTable
CREATE TABLE "holiday_calendar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "company_id" UUID,
    "branch_id" UUID,
    "scope_key" TEXT NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "holiday_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "accrual" "leave_accrual" NOT NULL DEFAULT 'YEARLY',
    "quota_days" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "carry_forward_max_days" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "allow_half_day" BOOLEAN NOT NULL DEFAULT true,
    "include_non_working_days" BOOLEAN NOT NULL DEFAULT false,
    "min_notice_days" INTEGER NOT NULL DEFAULT 0,
    "max_days_per_request" INTEGER,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_ledger_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" "leave_ledger_kind" NOT NULL,
    "days" DECIMAL(6,1) NOT NULL,
    "period_key" TEXT,
    "request_id" UUID,
    "note" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "half_day" "half_day",
    "days" DECIMAL(5,1) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "leave_request_status" NOT NULL DEFAULT 'PENDING',
    "approval_request_id" UUID,
    "requested_by_user_id" UUID NOT NULL,
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holiday_calendar_tenant_id_id_key" ON "holiday_calendar"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_calendar_tenant_id_scope_key_key" ON "holiday_calendar"("tenant_id", "scope_key");

-- CreateIndex
CREATE INDEX "holiday_tenant_id_date_idx" ON "holiday"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_tenant_id_calendar_id_date_key" ON "holiday"("tenant_id", "calendar_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_type_tenant_id_id_key" ON "leave_type"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "leave_type_tenant_id_code_key" ON "leave_type"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "leave_ledger_entry_tenant_id_employee_id_leave_type_id_year_idx" ON "leave_ledger_entry"("tenant_id", "employee_id", "leave_type_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "leave_ledger_entry_period_key_key" ON "leave_ledger_entry"("tenant_id", "employee_id", "leave_type_id", "kind", "period_key");

-- CreateIndex
CREATE INDEX "leave_request_tenant_id_employee_id_from_date_idx" ON "leave_request"("tenant_id", "employee_id", "from_date");

-- CreateIndex
CREATE INDEX "leave_request_tenant_id_status_idx" ON "leave_request"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leave_request_tenant_id_id_key" ON "leave_request"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "holiday_calendar" ADD CONSTRAINT "holiday_calendar_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_calendar" ADD CONSTRAINT "holiday_calendar_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_calendar" ADD CONSTRAINT "holiday_calendar_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_tenant_id_calendar_id_fkey" FOREIGN KEY ("tenant_id", "calendar_id") REFERENCES "holiday_calendar"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_tenant_id_leave_type_id_fkey" FOREIGN KEY ("tenant_id", "leave_type_id") REFERENCES "leave_type"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "leave_request"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_tenant_id_leave_type_id_fkey" FOREIGN KEY ("tenant_id", "leave_type_id") REFERENCES "leave_type"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
