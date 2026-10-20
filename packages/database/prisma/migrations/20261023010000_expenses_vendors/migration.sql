-- CreateEnum
CREATE TYPE "expense_claim_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "vendor" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requires_receipt" BOOLEAN NOT NULL DEFAULT false,
    "max_amount" DECIMAL(16,2),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claim" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "status" "expense_claim_status" NOT NULL DEFAULT 'DRAFT',
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "approval_request_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "payment_reference" TEXT,
    "paid_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "receipt_number" TEXT,

    CONSTRAINT "expense_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_tenant_id_id_key" ON "vendor"("tenant_id", "id");
CREATE UNIQUE INDEX "vendor_tenant_id_code_key" ON "vendor"("tenant_id", "code");
CREATE UNIQUE INDEX "expense_category_tenant_id_id_key" ON "expense_category"("tenant_id", "id");
CREATE UNIQUE INDEX "expense_category_tenant_id_code_key" ON "expense_category"("tenant_id", "code");
CREATE UNIQUE INDEX "expense_claim_tenant_id_id_key" ON "expense_claim"("tenant_id", "id");
CREATE UNIQUE INDEX "expense_claim_tenant_id_number_key" ON "expense_claim"("tenant_id", "number");
CREATE INDEX "expense_claim_tenant_id_employee_id_status_idx" ON "expense_claim"("tenant_id", "employee_id", "status");
CREATE INDEX "expense_claim_tenant_id_status_idx" ON "expense_claim"("tenant_id", "status");
CREATE UNIQUE INDEX "expense_line_claim_id_position_key" ON "expense_line"("claim_id", "position");
CREATE INDEX "expense_line_tenant_id_category_id_idx" ON "expense_line"("tenant_id", "category_id");

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_claim" ADD CONSTRAINT "expense_claim_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_claim" ADD CONSTRAINT "expense_claim_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_line" ADD CONSTRAINT "expense_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_line" ADD CONSTRAINT "expense_line_tenant_id_claim_id_fkey" FOREIGN KEY ("tenant_id", "claim_id") REFERENCES "expense_claim"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_line" ADD CONSTRAINT "expense_line_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "expense_category"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
