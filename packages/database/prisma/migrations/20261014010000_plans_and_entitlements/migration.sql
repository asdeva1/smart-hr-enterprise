-- CreateEnum
CREATE TYPE "plan_version_status" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "billing_period" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "pricing_model" AS ENUM ('PER_USER', 'PER_EMPLOYEE', 'FLAT');

-- CreateEnum
CREATE TYPE "addon_kind" AS ENUM ('FEATURE', 'CAPACITY', 'SERVICE');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "entitlement_override_kind" AS ENUM ('FEATURE', 'LIMIT');

-- CreateTable
CREATE TABLE "plan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_version" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "plan_version_status" NOT NULL DEFAULT 'DRAFT',
    "features" TEXT[],
    "limits" JSONB NOT NULL DEFAULT '{}',
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "grace_days" INTEGER NOT NULL DEFAULT 14,
    "support_level" TEXT NOT NULL DEFAULT 'STANDARD',
    "deployment_models" TEXT[],
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "plan_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_price" (
    "id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "billing_period" "billing_period" NOT NULL,
    "pricing_model" "pricing_model" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "plan_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "addon_kind" NOT NULL,
    "features" TEXT[],
    "limits" JSONB NOT NULL DEFAULT '{}',
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "addon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_price" (
    "id" UUID NOT NULL,
    "addon_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "billing_period" "billing_period" NOT NULL,
    "pricing_model" "pricing_model" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "addon_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "status" "subscription_status" NOT NULL,
    "billing_period" "billing_period" NOT NULL DEFAULT 'MONTHLY',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "trial_ends_at" TIMESTAMPTZ(6),
    "current_period_start" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "grace_ends_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "provider_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_addon" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "addon_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_addon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_override" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "entitlement_override_kind" NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN,
    "value" INTEGER,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "entitlement_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "subscription_status",
    "to_status" "subscription_status",
    "plan_version_id" UUID,
    "actor_user_id" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_code_key" ON "plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_version_plan_id_version_key" ON "plan_version"("plan_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "plan_price_plan_version_id_currency_billing_period_key" ON "plan_price"("plan_version_id", "currency", "billing_period");

-- CreateIndex
CREATE UNIQUE INDEX "addon_code_key" ON "addon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "addon_price_addon_id_currency_billing_period_key" ON "addon_price"("addon_id", "currency", "billing_period");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_tenant_id_key" ON "subscription"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_tenant_id_id_key" ON "subscription"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "subscription_addon_tenant_id_idx" ON "subscription_addon"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_addon_subscription_id_addon_id_key" ON "subscription_addon"("subscription_id", "addon_id");

-- CreateIndex
CREATE INDEX "entitlement_override_tenant_id_idx" ON "entitlement_override"("tenant_id");

-- CreateIndex
CREATE INDEX "subscription_event_tenant_id_occurred_at_idx" ON "subscription_event"("tenant_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "plan_version" ADD CONSTRAINT "plan_version_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_price" ADD CONSTRAINT "plan_price_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_price" ADD CONSTRAINT "addon_price_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_addon" ADD CONSTRAINT "subscription_addon_tenant_id_subscription_id_fkey" FOREIGN KEY ("tenant_id", "subscription_id") REFERENCES "subscription"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_addon" ADD CONSTRAINT "subscription_addon_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
