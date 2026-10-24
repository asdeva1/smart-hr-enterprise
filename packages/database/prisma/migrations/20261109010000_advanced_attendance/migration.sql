-- Hand-written migration: attendance policy, work locations, rosters, overtime approval, punch location.
CREATE TYPE "geofence_mode" AS ENUM ('OFF', 'WARN', 'ENFORCE');
CREATE TYPE "overtime_decision" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "attendance_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "overtime_enabled" BOOLEAN NOT NULL DEFAULT true,
    "overtime_threshold_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_round_minutes" INTEGER NOT NULL DEFAULT 15,
    "overtime_daily_cap_minutes" INTEGER,
    "overtime_off_day_counts" BOOLEAN NOT NULL DEFAULT true,
    "overtime_needs_approval" BOOLEAN NOT NULL DEFAULT true,
    "max_corrections_per_month" INTEGER,
    "max_correction_backdate_days" INTEGER,
    "geofence_mode" "geofence_mode" NOT NULL DEFAULT 'OFF',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by_user_id" UUID,
    CONSTRAINT "attendance_policy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_policy_tenant_id_key" ON "attendance_policy"("tenant_id");
ALTER TABLE "attendance_policy" ADD CONSTRAINT "attendance_policy_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "work_location" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "radius_meters" INTEGER NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "work_location_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "work_location_tenant_id_id_key" ON "work_location"("tenant_id", "id");
CREATE UNIQUE INDEX "work_location_tenant_id_name_key" ON "work_location"("tenant_id", "name");
ALTER TABLE "work_location" ADD CONSTRAINT "work_location_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "roster_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shift_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roster_entry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "roster_entry_tenant_id_employee_id_date_key" ON "roster_entry"("tenant_id", "employee_id", "date");
CREATE INDEX "roster_entry_tenant_id_date_idx" ON "roster_entry"("tenant_id", "date");
ALTER TABLE "roster_entry" ADD CONSTRAINT "roster_entry_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "roster_entry" ADD CONSTRAINT "roster_entry_employee_fkey"
    FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "roster_entry" ADD CONSTRAINT "roster_entry_shift_fkey"
    FOREIGN KEY ("tenant_id", "shift_id") REFERENCES "shift"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "overtime_approval" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "decision" "overtime_decision" NOT NULL,
    "approved_minutes" INTEGER NOT NULL,
    "note" TEXT,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "overtime_approval_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "overtime_approval_tenant_id_employee_id_date_key" ON "overtime_approval"("tenant_id", "employee_id", "date");
CREATE INDEX "overtime_approval_tenant_id_date_idx" ON "overtime_approval"("tenant_id", "date");
ALTER TABLE "overtime_approval" ADD CONSTRAINT "overtime_approval_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "overtime_approval" ADD CONSTRAINT "overtime_approval_employee_fkey"
    FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_punch"
    ADD COLUMN "latitude" DECIMAL(9,6),
    ADD COLUMN "longitude" DECIMAL(9,6),
    ADD COLUMN "accuracy_meters" INTEGER,
    ADD COLUMN "location_id" UUID,
    ADD COLUMN "outside_geofence" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "attendance_punch" ADD CONSTRAINT "attendance_punch_location_fkey"
    FOREIGN KEY ("tenant_id", "location_id") REFERENCES "work_location"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
