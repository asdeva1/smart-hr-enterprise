-- Hand-written migration: row-level security, grants and the stock ledger rules for inventory.

ALTER TABLE "warehouse" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "warehouse"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "inventory_item" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inventory_item"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "stock_movement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_movement"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Warehouses and items are archived, never deleted. The stock ledger only ever grows.
GRANT SELECT, INSERT, UPDATE ON "warehouse" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "inventory_item" TO app_rw;
GRANT SELECT, INSERT ON "stock_movement" TO app_rw;

-- Every movement has the right sign for what it is, and is never zero.
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_sign"
    CHECK (
        "quantity" <> 0 AND (
            ("kind" IN ('RECEIPT', 'TRANSFER_IN') AND "quantity" > 0) OR
            ("kind" IN ('ISSUE', 'TRANSFER_OUT') AND "quantity" < 0) OR
            "kind" = 'ADJUSTMENT'
        )
    );

-- Stock in a warehouse can never go below zero, even when two people issue the same item at once: movements
-- for one item and warehouse are serialised, then the new balance is checked.
CREATE FUNCTION stock_movement_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
        balance numeric;
    BEGIN
        PERFORM pg_advisory_xact_lock(hashtext(NEW."item_id"::text || ':' || NEW."warehouse_id"::text));
        SELECT coalesce(sum(m."quantity"), 0) INTO balance
            FROM "stock_movement" m
            WHERE m."item_id" = NEW."item_id" AND m."warehouse_id" = NEW."warehouse_id";
        IF balance + NEW."quantity" < 0 THEN
            RAISE EXCEPTION 'not enough stock: % on hand, % requested', balance, -NEW."quantity"
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER stock_movement_check
    BEFORE INSERT ON "stock_movement"
    FOR EACH ROW EXECUTE FUNCTION stock_movement_guard();
