-- CreateEnum
CREATE TYPE "checkout_status" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "checkout_order" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "organisation_name" TEXT NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "billing_period" "billing_period" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "status" "checkout_status" NOT NULL DEFAULT 'PENDING',
    "tenant_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),

    CONSTRAINT "checkout_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkout_order_provider_order_id_key" ON "checkout_order"("provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_order_provider_payment_id_key" ON "checkout_order"("provider_payment_id");

-- CreateIndex
CREATE INDEX "checkout_order_email_idx" ON "checkout_order"("email");

-- AddForeignKey
ALTER TABLE "checkout_order" ADD CONSTRAINT "checkout_order_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
