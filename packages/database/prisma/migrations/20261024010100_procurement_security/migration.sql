-- Hand-written migration: row-level security and grants for procurement.

ALTER TABLE "purchase_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_request"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "purchase_request_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_request_line"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "purchase_order" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_order"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "purchase_order_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_order_line"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "goods_receipt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "goods_receipt"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "goods_receipt_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "goods_receipt_line"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Requests and orders are kept; draft lines can be replaced. Received quantities are the only thing that
-- changes on an order line after it is approved. Receipts are kept as received.
GRANT SELECT, INSERT, UPDATE ON "purchase_request" TO app_rw;
GRANT SELECT, INSERT, DELETE ON "purchase_request_line" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "purchase_order" TO app_rw;
GRANT SELECT, INSERT, DELETE ON "purchase_order_line" TO app_rw;
GRANT UPDATE ("received_quantity") ON "purchase_order_line" TO app_rw;
GRANT SELECT, INSERT ON "goods_receipt" TO app_rw;
GRANT SELECT, INSERT ON "goods_receipt_line" TO app_rw;
