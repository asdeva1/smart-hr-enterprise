-- CreateTable
CREATE TABLE "lookup_value" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "list" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lookup_value_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lookup_value_tenant_id_list_status_sort_order_idx" ON "lookup_value"("tenant_id", "list", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_value_tenant_id_list_code_key" ON "lookup_value"("tenant_id", "list", "code");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_value_tenant_id_id_key" ON "lookup_value"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "lookup_value" ADD CONSTRAINT "lookup_value_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
