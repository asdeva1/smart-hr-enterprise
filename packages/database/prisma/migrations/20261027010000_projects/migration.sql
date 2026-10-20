-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "time_entry_status" AS ENUM ('OPEN', 'APPROVED');

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client_name" TEXT,
    "status" "project_status" NOT NULL DEFAULT 'ACTIVE',
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "hourly_rate" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "budget_hours" DECIMAL(10,2),
    "start_date" DATE,
    "end_date" DATE,
    "manager_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_member" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "cost_rate" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "status" "time_entry_status" NOT NULL DEFAULT 'OPEN',
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "time_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_tenant_id_id_key" ON "project"("tenant_id", "id");
CREATE UNIQUE INDEX "project_tenant_id_code_key" ON "project"("tenant_id", "code");
CREATE UNIQUE INDEX "project_member_project_id_employee_id_key" ON "project_member"("project_id", "employee_id");
CREATE INDEX "project_member_tenant_id_employee_id_idx" ON "project_member"("tenant_id", "employee_id");
CREATE INDEX "time_entry_tenant_id_employee_id_work_date_idx" ON "time_entry"("tenant_id", "employee_id", "work_date");
CREATE INDEX "time_entry_tenant_id_project_id_work_date_idx" ON "time_entry"("tenant_id", "project_id", "work_date");

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_manager_id_fkey" FOREIGN KEY ("tenant_id", "manager_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "project"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "project"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
