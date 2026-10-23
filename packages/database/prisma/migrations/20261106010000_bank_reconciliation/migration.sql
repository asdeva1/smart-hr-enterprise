-- Bank reconciliation: imported bank statements and their lines, matched to journal lines on a bank account.

CREATE TYPE "bank_line_status" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

CREATE TABLE "bank_statement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "opening_balance" DECIMAL(16,2),
    "closing_balance" DECIMAL(16,2),
    "line_count" INTEGER NOT NULL,
    "imported_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bank_statement_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "deposit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "withdrawal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(16,2),
    "dedupe_key" TEXT NOT NULL,
    "status" "bank_line_status" NOT NULL DEFAULT 'UNMATCHED',
    "journal_line_id" UUID,
    "matched_by_user_id" UUID,
    "matched_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "journal_line_tenant_id_id_key" ON "journal_line"("tenant_id", "id");
CREATE UNIQUE INDEX "bank_statement_tenant_id_id_key" ON "bank_statement"("tenant_id", "id");
CREATE INDEX "bank_statement_tenant_id_account_id_period_to_idx" ON "bank_statement"("tenant_id", "account_id", "period_to");
CREATE UNIQUE INDEX "bank_statement_line_account_id_dedupe_key_key" ON "bank_statement_line"("account_id", "dedupe_key");
CREATE UNIQUE INDEX "bank_statement_line_tenant_id_journal_line_id_key" ON "bank_statement_line"("tenant_id", "journal_line_id");
CREATE INDEX "bank_statement_line_tenant_id_account_id_status_date_idx" ON "bank_statement_line"("tenant_id", "account_id", "status", "date");

ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_tenant_id_account_id_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "ledger_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_tenant_id_account_id_fkey" FOREIGN KEY ("tenant_id", "account_id") REFERENCES "ledger_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_tenant_id_statement_id_fkey" FOREIGN KEY ("tenant_id", "statement_id") REFERENCES "bank_statement"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_tenant_id_journal_line_id_fkey" FOREIGN KEY ("tenant_id", "journal_line_id") REFERENCES "journal_line"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
