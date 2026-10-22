-- Sales and receivables: customers, invoice templates, seller settings, sales documents, receipts.

CREATE TYPE "sales_doc_type" AS ENUM ('INVOICE', 'QUOTATION', 'PROFORMA', 'CHALLAN', 'CREDIT_NOTE');
CREATE TYPE "sales_doc_status" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
CREATE TYPE "payment_mode" AS ENUM ('BANK', 'CASH', 'UPI', 'CARD', 'CHEQUE');

CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "state_code" CHAR(2),
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "billing_address" TEXT,
    "shipping_address" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 15,
    "notes" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "layout" TEXT NOT NULL DEFAULT 'CLASSIC',
    "accent" TEXT NOT NULL DEFAULT '#1d56c9',
    "show_hsn" BOOLEAN NOT NULL DEFAULT true,
    "show_gst_split" BOOLEAN NOT NULL DEFAULT true,
    "show_bank" BOOLEAN NOT NULL DEFAULT true,
    "show_upi" BOOLEAN NOT NULL DEFAULT true,
    "show_signatory" BOOLEAN NOT NULL DEFAULT false,
    "show_po" BOOLEAN NOT NULL DEFAULT true,
    "default_terms" TEXT,
    "default_note" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "invoice_template_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_setting" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "state_code" CHAR(2),
    "address" TEXT,
    "bank_name" TEXT,
    "bank_account_no" TEXT,
    "bank_ifsc" TEXT,
    "upi_id" TEXT,
    "signatory" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "sales_setting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "template_id" UUID,
    "type" "sales_doc_type" NOT NULL,
    "number" TEXT,
    "status" "sales_doc_status" NOT NULL DEFAULT 'DRAFT',
    "date" DATE NOT NULL,
    "due_date" DATE,
    "po_number" TEXT,
    "place_of_supply" CHAR(2),
    "note" TEXT,
    "terms" TEXT,
    "subtotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "settled" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "related_id" UUID,
    "journal_entry_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "sales_document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_document_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "hsn" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT,
    "rate" DECIMAL(16,2) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(16,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_document_line_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_receipt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "deposit_account_id" UUID NOT NULL,
    "journal_entry_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_receipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "receipt_allocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "receipt_allocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_tenant_id_id_key" ON "customer"("tenant_id","id");
CREATE UNIQUE INDEX "customer_tenant_id_code_key" ON "customer"("tenant_id","code");
CREATE UNIQUE INDEX "invoice_template_tenant_id_id_key" ON "invoice_template"("tenant_id","id");
CREATE UNIQUE INDEX "invoice_template_tenant_id_name_key" ON "invoice_template"("tenant_id","name");
CREATE UNIQUE INDEX "sales_setting_company_id_key" ON "sales_setting"("company_id");
CREATE UNIQUE INDEX "sales_setting_tenant_id_id_key" ON "sales_setting"("tenant_id","id");
CREATE UNIQUE INDEX "sales_document_tenant_id_id_key" ON "sales_document"("tenant_id","id");
CREATE INDEX "sales_document_company_id_type_status_idx" ON "sales_document"("company_id","type","status");
CREATE INDEX "sales_document_customer_id_idx" ON "sales_document"("customer_id");
CREATE UNIQUE INDEX "sales_document_line_document_id_position_key" ON "sales_document_line"("document_id","position");
CREATE UNIQUE INDEX "customer_receipt_tenant_id_id_key" ON "customer_receipt"("tenant_id","id");
CREATE UNIQUE INDEX "customer_receipt_company_id_number_key" ON "customer_receipt"("company_id","number");
CREATE INDEX "customer_receipt_customer_id_idx" ON "customer_receipt"("customer_id");
CREATE INDEX "receipt_allocation_document_id_idx" ON "receipt_allocation"("document_id");

ALTER TABLE "customer" ADD CONSTRAINT "customer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_template" ADD CONSTRAINT "invoice_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_setting" ADD CONSTRAINT "sales_setting_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_document" ADD CONSTRAINT "sales_document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_document_line" ADD CONSTRAINT "sales_document_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receipt" ADD CONSTRAINT "customer_receipt_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_allocation" ADD CONSTRAINT "receipt_allocation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_setting" ADD CONSTRAINT "sales_setting_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id","company_id") REFERENCES "company"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_document" ADD CONSTRAINT "sales_document_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id","company_id") REFERENCES "company"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_document" ADD CONSTRAINT "sales_document_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "customer"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_document" ADD CONSTRAINT "sales_document_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id","template_id") REFERENCES "invoice_template"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_document_line" ADD CONSTRAINT "sales_document_line_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id","document_id") REFERENCES "sales_document"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receipt" ADD CONSTRAINT "customer_receipt_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id","company_id") REFERENCES "company"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receipt" ADD CONSTRAINT "customer_receipt_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "customer"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_allocation" ADD CONSTRAINT "receipt_allocation_tenant_id_receipt_id_fkey" FOREIGN KEY ("tenant_id","receipt_id") REFERENCES "customer_receipt"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_allocation" ADD CONSTRAINT "receipt_allocation_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id","document_id") REFERENCES "sales_document"("tenant_id","id") ON DELETE RESTRICT ON UPDATE CASCADE;
