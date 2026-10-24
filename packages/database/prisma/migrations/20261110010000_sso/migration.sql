-- Hand-written migration: per-organisation single sign-on (OpenID Connect).
CREATE TABLE "sso_connection" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_sealed" TEXT NOT NULL,
    "allowed_domains" TEXT[],
    "require_verified_email" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by_user_id" UUID,
    CONSTRAINT "sso_connection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sso_connection_tenant_id_key" ON "sso_connection"("tenant_id");
ALTER TABLE "sso_connection" ADD CONSTRAINT "sso_connection_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_session" ADD COLUMN "sso_tenant_id" UUID;
