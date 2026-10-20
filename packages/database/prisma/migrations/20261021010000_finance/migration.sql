-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "journal_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "journal_source" AS ENUM ('MANUAL', 'REVERSAL', 'PAYROLL', 'PAYROLL_PAYMENT');

-- CreateTable
CREATE TABLE "ledger_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "account_type" NOT NULL,
    "system_key" TEXT,
    "description" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT,
    "date" DATE NOT NULL,
    "narration" TEXT NOT NULL,
    "source" "journal_source" NOT NULL DEFAULT 'MANUAL',
    "source_id" UUID,
    "status" "journal_status" NOT NULL DEFAULT 'DRAFT',
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "approval_request_id" UUID,
    "reverses_id" UUID,
    "reversed_by_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journal_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "narration" TEXT,
    "employee_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_lock" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "locked_until" DATE NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "book_lock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_tenant_id_id_key" ON "ledger_account"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_company_id_code_key" ON "ledger_account"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_company_id_system_key_key" ON "ledger_account"("company_id", "system_key");

-- CreateIndex
CREATE INDEX "journal_entry_tenant_id_company_id_status_date_idx" ON "journal_entry"("tenant_id", "company_id", "status", "date");

-- CreateIndex
CREATE INDEX "journal_entry_tenant_id_source_source_id_idx" ON "journal_entry"("tenant_id", "source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_tenant_id_id_key" ON "journal_entry"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_company_id_number_key" ON "journal_entry"("company_id", "number");

-- CreateIndex
CREATE INDEX "journal_line_tenant_id_account_id_idx" ON "journal_line"("tenant_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_line_entry_id_position_key" ON "journal_line"("entry_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "book_lock_tenant_id_company_id_key" ON "book_lock"("tenant_id", "company_id");

-- AddForeignKey
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_tenant_id_entry_id_fkey" FOREIGN KEY ("tenant_id", "entry_id") REFERENCES "journal_entry"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_tenant_id_account_id_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "ledger_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_lock" ADD CONSTRAINT "book_lock_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_lock" ADD CONSTRAINT "book_lock_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
