-- Purchases and payables: vendor bills, debit notes, payments to vendors.

CREATE TYPE "bill_type" AS ENUM ('BILL', 'DEBIT_NOTE');
CREATE TYPE "bill_status" AS ENUM ('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

CREATE TABLE "purchase_bill" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "type" "bill_type" NOT NULL DEFAULT 'BILL',
    "number" TEXT,
    "vendor_bill_no" TEXT,
    "status" "bill_status" NOT NULL DEFAULT 'DRAFT',
    "date" DATE NOT NULL,
    "due_date" DATE,
    "place_of_supply" CHAR(2),
    "note" TEXT,
    "subtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tds_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tds_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "settled" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "related_id" UUID,
    "journal_entry_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "purchase_bill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_bill_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "hsn" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(16,2) NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_bill_line_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vendor_payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "paid_from_account_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_allocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_allocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_bill_tenant_id_id_key" ON "purchase_bill"("tenant_id","id");
CREATE INDEX "purchase_bill_company_id_type_status_idx" ON "purchase_bill"("company_id","type","status");
CREATE INDEX "purchase_bill_vendor_id_idx" ON "purchase_bill"("vendor_id");
CREATE UNIQUE INDEX "purchase_bill_line_bill_id_position_key" ON "purchase_bill_line"("bill_id","position");
CREATE UNIQUE INDEX "vendor_payment_tenant_id_id_key" ON "vendor_payment"("tenant_id","id");
CREATE UNIQUE INDEX "vendor_payment_company_id_number_key" ON "vendor_payment"("company_id","number");
CREATE INDEX "vendor_payment_vendor_id_idx" ON "vendor_payment"("vendor_id");
CREATE INDEX "payment_allocation_bill_id_idx" ON "payment_allocation"("bill_id");

ALTER TABLE "purchase_bill" ADD CONSTRAINT "purchase_bill_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_bill_line" ADD CONSTRAINT "purchase_bill_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_payment" ADD CONSTRAINT "vendor_payment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_bill" ADD CONSTRAINT "purchase_bill_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id","company_id") REFERENCES "company"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_bill" ADD CONSTRAINT "purchase_bill_tenant_id_vendor_id_fkey" FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "vendor"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_bill_line" ADD CONSTRAINT "purchase_bill_line_tenant_id_bill_id_fkey" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "purchase_bill"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_payment" ADD CONSTRAINT "vendor_payment_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id","company_id") REFERENCES "company"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_payment" ADD CONSTRAINT "vendor_payment_tenant_id_vendor_id_fkey" FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "vendor"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "vendor_payment"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_tenant_id_bill_id_fkey" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "purchase_bill"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
