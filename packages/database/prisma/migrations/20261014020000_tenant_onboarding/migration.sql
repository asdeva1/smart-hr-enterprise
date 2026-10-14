-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "archived_at" TIMESTAMPTZ(6),
ADD COLUMN     "brand_color" TEXT,
ADD COLUMN     "brand_logo_url" TEXT,
ADD COLUMN     "brand_name" TEXT,
ADD COLUMN     "offboarding_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "signup_request" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "organisation_name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "tenant_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signup_request_token_hash_key" ON "signup_request"("token_hash");

-- CreateIndex
CREATE INDEX "signup_request_email_idx" ON "signup_request"("email");
