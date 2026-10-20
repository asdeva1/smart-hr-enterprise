-- AlterEnum
ALTER TYPE "punch_source" ADD VALUE 'DEVICE';

-- CreateEnum
CREATE TYPE "biometric_vendor" AS ENUM ('ESSL', 'ZKTECO');

-- CreateEnum
CREATE TYPE "biometric_log_outcome" AS ENUM ('IMPORTED', 'UNMAPPED', 'DUPLICATE', 'REJECTED');

-- CreateTable
CREATE TABLE "biometric_device" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" "biometric_vendor" NOT NULL DEFAULT 'ESSL',
    "serial_number" TEXT NOT NULL,
    "location" TEXT,
    "time_zone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMPTZ(6),
    "last_punch_at" TIMESTAMPTZ(6),
    "attlog_stamp" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "biometric_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_enrollment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "device_code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "device_code" TEXT NOT NULL,
    "punched_at" TIMESTAMPTZ(6) NOT NULL,
    "raw_status" INTEGER,
    "verify_mode" INTEGER,
    "outcome" "biometric_log_outcome" NOT NULL,
    "employee_id" UUID,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "biometric_device_serial_number_key" ON "biometric_device"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_device_tenant_id_id_key" ON "biometric_device"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_enrollment_tenant_id_device_code_key" ON "biometric_enrollment"("tenant_id", "device_code");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_enrollment_tenant_id_employee_id_key" ON "biometric_enrollment"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "biometric_log_tenant_id_outcome_idx" ON "biometric_log"("tenant_id", "outcome");

-- CreateIndex
CREATE INDEX "biometric_log_tenant_id_received_at_idx" ON "biometric_log"("tenant_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_log_device_id_device_code_punched_at_key" ON "biometric_log"("device_id", "device_code", "punched_at");

-- AddForeignKey
ALTER TABLE "biometric_device" ADD CONSTRAINT "biometric_device_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_enrollment" ADD CONSTRAINT "biometric_enrollment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_enrollment" ADD CONSTRAINT "biometric_enrollment_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_log" ADD CONSTRAINT "biometric_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_log" ADD CONSTRAINT "biometric_log_tenant_id_device_id_fkey" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "biometric_device"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_log" ADD CONSTRAINT "biometric_log_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
