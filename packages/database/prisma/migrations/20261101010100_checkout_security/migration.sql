-- Hand-written migration: who may see and write purchases.

-- Checkout orders exist before any organisation does, so no tenant policy fits. Only platform actors (the
-- checkout service runs as one, after the payment provider's signature is verified) can see or write them;
-- any other transaction sees nothing. Orders are never deleted by the application.
ALTER TABLE "checkout_order" ENABLE ROW LEVEL SECURITY;
CREATE POLICY checkout_order_platform ON "checkout_order"
    USING (app_is_platform_actor())
    WITH CHECK (app_is_platform_actor());
GRANT SELECT, INSERT, UPDATE ON "checkout_order" TO app_rw;

-- Once an order is paid, what was bought and for whom is frozen; only the link to the organisation is added.
CREATE FUNCTION checkout_order_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF OLD."status" = 'PAID' AND (
            NEW."email" IS DISTINCT FROM OLD."email"
            OR NEW."plan_version_id" IS DISTINCT FROM OLD."plan_version_id"
            OR NEW."billing_period" IS DISTINCT FROM OLD."billing_period"
            OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
            OR NEW."currency" IS DISTINCT FROM OLD."currency"
            OR NEW."amount_minor" IS DISTINCT FROM OLD."amount_minor"
            OR NEW."provider_order_id" IS DISTINCT FROM OLD."provider_order_id"
            OR NEW."provider_payment_id" IS DISTINCT FROM OLD."provider_payment_id"
            OR NEW."status" IS DISTINCT FROM OLD."status"
            OR NEW."paid_at" IS DISTINCT FROM OLD."paid_at"
        ) THEN
            RAISE EXCEPTION 'checkout_order %: a paid order cannot be changed', OLD."id";
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER checkout_order_paid_guard
    BEFORE UPDATE ON "checkout_order"
    FOR EACH ROW EXECUTE FUNCTION checkout_order_guard();
