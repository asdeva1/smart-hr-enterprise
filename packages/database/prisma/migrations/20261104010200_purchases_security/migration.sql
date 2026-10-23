-- Hand-written migration: row-level security and grants for purchases and payables.

ALTER TABLE "purchase_bill" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_bill"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "purchase_bill_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_bill_line"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "vendor_payment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vendor_payment"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "payment_allocation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_allocation"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Nothing is deleted: bills are cancelled while drafts or corrected with a debit note; payments are permanent.
GRANT SELECT, INSERT, UPDATE ON "purchase_bill" TO app_rw;
GRANT SELECT, INSERT, DELETE ON "purchase_bill_line" TO app_rw;
GRANT SELECT, INSERT ON "vendor_payment" TO app_rw;
GRANT UPDATE ("journal_entry_id") ON "vendor_payment" TO app_rw;
GRANT SELECT, INSERT ON "payment_allocation" TO app_rw;

ALTER TABLE "purchase_bill" ADD CONSTRAINT "purchase_bill_amounts_check"
    CHECK ("total" >= 0 AND "tds_amount" >= 0 AND "tds_amount" <= "total" AND "settled" >= 0
           AND "settled" <= "total" - "tds_amount");
ALTER TABLE "vendor_payment" ADD CONSTRAINT "vendor_payment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_amount_check" CHECK ("amount" > 0);
