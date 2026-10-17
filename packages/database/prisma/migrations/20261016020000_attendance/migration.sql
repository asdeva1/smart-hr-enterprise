-- CreateEnum
CREATE TYPE "attendance_day_status" AS ENUM ('PRESENT', 'HALF_DAY', 'ABSENT', 'WEEKLY_OFF');

-- CreateEnum
CREATE TYPE "punch_direction" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "punch_source" AS ENUM ('WEB', 'ADMIN', 'CORRECTION', 'IMPORT');

-- CreateEnum
CREATE TYPE "attendance_correction_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- AlterTable
ALTER TABLE "approval_request" ADD COLUMN     "subject_employee_id" UUID;

-- CreateTable
CREATE TABLE "shift" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "grace_minutes" INTEGER NOT NULL DEFAULT 10,
    "half_day_minutes" INTEGER NOT NULL DEFAULT 240,
    "full_day_minutes" INTEGER NOT NULL DEFAULT 480,
    "weekly_offs" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_punch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "direction" "punch_direction" NOT NULL,
    "source" "punch_source" NOT NULL,
    "note" TEXT,
    "recorded_by_user_id" UUID,
    "correction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_day" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shift_id" UUID,
    "status" "attendance_day_status" NOT NULL,
    "first_in" TIMESTAMPTZ(6),
    "last_out" TIMESTAMPTZ(6),
    "worked_minutes" INTEGER NOT NULL DEFAULT 0,
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "early_leave_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "corrected" BOOLEAN NOT NULL DEFAULT false,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_correction" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "in_at" TIMESTAMPTZ(6),
    "out_at" TIMESTAMPTZ(6),
    "reason" TEXT NOT NULL,
    "status" "attendance_correction_status" NOT NULL DEFAULT 'PENDING',
    "approval_request_id" UUID,
    "requested_by_user_id" UUID NOT NULL,
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_correction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_tenant_id_id_key" ON "shift"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shift_tenant_id_code_key" ON "shift"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "shift_assignment_tenant_id_shift_id_idx" ON "shift_assignment"("tenant_id", "shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "shift_assignment_tenant_id_employee_id_effective_from_key" ON "shift_assignment"("tenant_id", "employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "attendance_punch_tenant_id_employee_id_at_idx" ON "attendance_punch"("tenant_id", "employee_id", "at");

-- CreateIndex
CREATE INDEX "attendance_day_tenant_id_date_idx" ON "attendance_day"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_day_tenant_id_employee_id_date_key" ON "attendance_day"("tenant_id", "employee_id", "date");

-- CreateIndex
CREATE INDEX "attendance_correction_tenant_id_employee_id_date_idx" ON "attendance_correction"("tenant_id", "employee_id", "date");

-- CreateIndex
CREATE INDEX "attendance_correction_tenant_id_status_idx" ON "attendance_correction"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_correction_tenant_id_id_key" ON "attendance_correction"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_tenant_id_subject_employee_id_fkey" FOREIGN KEY ("tenant_id", "subject_employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_tenant_id_shift_id_fkey" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punch" ADD CONSTRAINT "attendance_punch_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punch" ADD CONSTRAINT "attendance_punch_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punch" ADD CONSTRAINT "attendance_punch_tenant_id_correction_id_fkey" FOREIGN KEY ("tenant_id", "correction_id") REFERENCES "attendance_correction"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_tenant_id_shift_id_fkey" FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
