-- CreateEnum
CREATE TYPE "stock_movement_kind" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "warehouse" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT,
    "reorder_level" DECIMAL(14,3),
    "standard_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "kind" "stock_movement_kind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(16,2),
    "occurred_on" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "transfer_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_tenant_id_id_key" ON "warehouse"("tenant_id", "id");
CREATE UNIQUE INDEX "warehouse_tenant_id_code_key" ON "warehouse"("tenant_id", "code");
CREATE UNIQUE INDEX "inventory_item_tenant_id_id_key" ON "inventory_item"("tenant_id", "id");
CREATE UNIQUE INDEX "inventory_item_tenant_id_sku_key" ON "inventory_item"("tenant_id", "sku");
CREATE INDEX "stock_movement_tenant_id_item_id_warehouse_id_idx" ON "stock_movement"("tenant_id", "item_id", "warehouse_id");
CREATE INDEX "stock_movement_tenant_id_occurred_on_idx" ON "stock_movement"("tenant_id", "occurred_on");
CREATE INDEX "stock_movement_tenant_id_transfer_id_idx" ON "stock_movement"("tenant_id", "transfer_id");

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "inventory_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
