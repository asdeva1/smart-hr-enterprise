-- Per-employee licences: the number of employees an organisation has bought is its employee limit.
ALTER TABLE "subscription" ADD COLUMN "licensed_employees" INTEGER;
ALTER TABLE "subscription"
    ADD CONSTRAINT subscription_licensed_employees_positive CHECK ("licensed_employees" IS NULL OR "licensed_employees" >= 1);

ALTER TABLE "checkout_order" ADD COLUMN "licensed_employees" INTEGER;
ALTER TABLE "checkout_order"
    ADD CONSTRAINT checkout_order_licensed_employees_positive CHECK ("licensed_employees" IS NULL OR "licensed_employees" >= 1);
