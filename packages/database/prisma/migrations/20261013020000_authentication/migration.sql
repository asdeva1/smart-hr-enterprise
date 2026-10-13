-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "mfa_totp_secret" TEXT,
    "mfa_totp_pending_secret" TEXT,
    "mfa_totp_last_step" BIGINT,
    "mfa_enabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_membership" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "is_tenant_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "active_tenant_id" UUID,
    "mfa_pending" BOOLEAN NOT NULL DEFAULT false,
    "reauthenticated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_code" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "outcome" "audit_outcome" NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "tenant_membership_user_id_idx" ON "tenant_membership"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_membership_tenant_id_user_id_key" ON "tenant_membership"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_session_token_hash_key" ON "user_session"("token_hash");

-- CreateIndex
CREATE INDEX "user_session_user_id_idx" ON "user_session"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_token_hash_key" ON "password_reset_token"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_token_user_id_idx" ON "password_reset_token"("user_id");

-- CreateIndex
CREATE INDEX "mfa_recovery_code_user_id_idx" ON "mfa_recovery_code"("user_id");

-- CreateIndex
CREATE INDEX "audit_event_tenant_id_occurred_at_idx" ON "audit_event"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_event_actor_user_id_occurred_at_idx" ON "audit_event"("actor_user_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_active_tenant_id_fkey" FOREIGN KEY ("active_tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
