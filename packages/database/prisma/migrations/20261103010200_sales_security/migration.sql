-- Hand-written migration: row-level security and grants for sales and receivables.

ALTER TABLE "customer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "invoice_template" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoice_template"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "sales_setting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_setting"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "sales_document" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_document"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "sales_document_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_document_line"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "customer_receipt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer_receipt"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "receipt_allocation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "receipt_allocation"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Nothing here is deleted: customers and templates are archived; documents are cancelled or credited;
-- receipts are permanent. Only draft lines are rewritten (enforced by the application).
GRANT SELECT, INSERT, UPDATE ON "customer" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "invoice_template" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "sales_setting" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "sales_document" TO app_rw;
GRANT SELECT, INSERT, DELETE ON "sales_document_line" TO app_rw;
GRANT SELECT, INSERT ON "customer_receipt" TO app_rw;
GRANT UPDATE ("journal_entry_id") ON "customer_receipt" TO app_rw;
GRANT SELECT, INSERT ON "receipt_allocation" TO app_rw;

ALTER TABLE "sales_document" ADD CONSTRAINT "sales_document_amounts_check"
    CHECK ("total" >= 0 AND "settled" >= 0 AND "settled" <= "total");
ALTER TABLE "customer_receipt" ADD CONSTRAINT "customer_receipt_amount_check" CHECK ("amount" > 0);
ALTER TABLE "receipt_allocation" ADD CONSTRAINT "receipt_allocation_amount_check" CHECK ("amount" > 0);
