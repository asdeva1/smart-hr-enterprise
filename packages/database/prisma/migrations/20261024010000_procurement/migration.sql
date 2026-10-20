-- CreateEnum
CREATE TYPE "purchase_request_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'ORDERED');

-- CreateEnum
CREATE TYPE "purchase_order_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "purchase_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "justification" TEXT,
    "status" "purchase_request_status" NOT NULL DEFAULT 'DRAFT',
    "estimated_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "approval_request_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "estimated_unit_price" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "purchase_request_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "request_id" UUID,
    "number" TEXT,
    "status" "purchase_order_status" NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL,
    "expected_date" DATE,
    "terms" TEXT,
    "subtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "approval_request_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_price" DECIMAL(16,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "received_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "received_on" DATE NOT NULL,
    "note" TEXT,
    "received_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "goods_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_request_tenant_id_id_key" ON "purchase_request"("tenant_id", "id");
CREATE UNIQUE INDEX "purchase_request_tenant_id_number_key" ON "purchase_request"("tenant_id", "number");
CREATE INDEX "purchase_request_tenant_id_status_idx" ON "purchase_request"("tenant_id", "status");
CREATE INDEX "purchase_request_tenant_id_employee_id_idx" ON "purchase_request"("tenant_id", "employee_id");
CREATE UNIQUE INDEX "purchase_request_line_request_id_position_key" ON "purchase_request_line"("request_id", "position");
CREATE UNIQUE INDEX "purchase_order_tenant_id_id_key" ON "purchase_order"("tenant_id", "id");
CREATE UNIQUE INDEX "purchase_order_tenant_id_number_key" ON "purchase_order"("tenant_id", "number");
CREATE INDEX "purchase_order_tenant_id_company_id_status_idx" ON "purchase_order"("tenant_id", "company_id", "status");
CREATE INDEX "purchase_order_tenant_id_vendor_id_idx" ON "purchase_order"("tenant_id", "vendor_id");
CREATE UNIQUE INDEX "purchase_order_line_tenant_id_id_key" ON "purchase_order_line"("tenant_id", "id");
CREATE UNIQUE INDEX "purchase_order_line_order_id_position_key" ON "purchase_order_line"("order_id", "position");
CREATE UNIQUE INDEX "goods_receipt_tenant_id_id_key" ON "goods_receipt"("tenant_id", "id");
CREATE UNIQUE INDEX "goods_receipt_tenant_id_number_key" ON "goods_receipt"("tenant_id", "number");
CREATE INDEX "goods_receipt_tenant_id_order_id_idx" ON "goods_receipt"("tenant_id", "order_id");
CREATE UNIQUE INDEX "goods_receipt_line_receipt_id_order_line_id_key" ON "goods_receipt_line"("receipt_id", "order_line_id");

-- AddForeignKey
ALTER TABLE "purchase_request" ADD CONSTRAINT "purchase_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_request" ADD CONSTRAINT "purchase_request_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_request_line" ADD CONSTRAINT "purchase_request_line_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "purchase_request"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_vendor_id_fkey" FOREIGN KEY ("tenant_id", "vendor_id") REFERENCES "vendor"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "purchase_request"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "purchase_order"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "purchase_order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_tenant_id_receipt_id_fkey" FOREIGN KEY ("tenant_id", "receipt_id") REFERENCES "goods_receipt"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_tenant_id_order_line_id_fkey" FOREIGN KEY ("tenant_id", "order_line_id") REFERENCES "purchase_order_line"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
