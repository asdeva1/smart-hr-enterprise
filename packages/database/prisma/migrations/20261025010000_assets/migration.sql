-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('IN_STOCK', 'ASSIGNED', 'UNDER_REPAIR', 'RETIRED');

-- CreateTable
CREATE TABLE "asset" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "serial_number" TEXT,
    "vendor_id" UUID,
    "purchase_date" DATE NOT NULL,
    "purchase_cost" DECIMAL(16,2) NOT NULL,
    "salvage_value" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "asset_status" NOT NULL DEFAULT 'IN_STOCK',
    "notes" TEXT,
    "retired_on" DATE,
    "retire_reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "assigned_on" DATE NOT NULL,
    "returned_on" DATE,
    "condition_out" TEXT,
    "condition_in" TEXT,
    "assigned_by_user_id" UUID NOT NULL,
    "returned_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_tenant_id_id_key" ON "asset"("tenant_id", "id");
CREATE UNIQUE INDEX "asset_tenant_id_tag_key" ON "asset"("tenant_id", "tag");
CREATE INDEX "asset_tenant_id_company_id_status_idx" ON "asset"("tenant_id", "company_id", "status");
CREATE INDEX "asset_assignment_tenant_id_asset_id_idx" ON "asset_assignment"("tenant_id", "asset_id");
CREATE INDEX "asset_assignment_tenant_id_employee_id_idx" ON "asset_assignment"("tenant_id", "employee_id");

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset" ADD CONSTRAINT "asset_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset" ADD CONSTRAINT "asset_tenant_id_vendor_id_fkey" FOREIGN KEY ("tenant_id", "vendor_id") REFERENCES "vendor"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_tenant_id_asset_id_fkey" FOREIGN KEY ("tenant_id", "asset_id") REFERENCES "asset"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_assignment" ADD CONSTRAINT "asset_assignment_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
