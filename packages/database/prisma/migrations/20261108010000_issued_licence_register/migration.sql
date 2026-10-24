-- Hand-written migration: the register of licences issued to in-house customers.
CREATE TYPE "IssuedLicenceStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "issued_licence" (
    "id" UUID NOT NULL,
    "licence_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "support_level" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL,
    "not_before" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "grace_days" INTEGER NOT NULL,
    "signature_checked" BOOLEAN NOT NULL,
    "notes" TEXT,
    "status" "IssuedLicenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,
    "renewed_by_id" UUID,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "issued_licence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "issued_licence_licence_id_key" ON "issued_licence"("licence_id");
CREATE INDEX "issued_licence_status_expires_at_idx" ON "issued_licence"("status", "expires_at");

ALTER TABLE "issued_licence"
    ADD CONSTRAINT "issued_licence_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id")
    REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
