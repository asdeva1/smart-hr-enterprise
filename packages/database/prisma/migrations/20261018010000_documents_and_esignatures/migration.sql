-- CreateEnum
CREATE TYPE "document_category" AS ENUM ('IDENTITY', 'EDUCATION', 'EMPLOYMENT', 'CONTRACT', 'LETTER', 'POLICY', 'MEDICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "signature_request_status" AS ENUM ('PENDING', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "signer_status" AS ENUM ('WAITING', 'PENDING', 'SIGNED', 'DECLINED');

-- CreateTable
CREATE TABLE "stored_file" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "encryption_key_id" TEXT NOT NULL,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "document_category" NOT NULL,
    "notes" TEXT,
    "visible_to_employee" BOOLEAN NOT NULL DEFAULT true,
    "expires_on" DATE,
    "expiry_notified_at" TIMESTAMPTZ(6),
    "status" "document_status" NOT NULL DEFAULT 'ACTIVE',
    "uploaded_by_user_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letter_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "document_category" NOT NULL DEFAULT 'LETTER',
    "body" TEXT NOT NULL,
    "status" "document_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "letter_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "sequential" BOOLEAN NOT NULL DEFAULT true,
    "status" "signature_request_status" NOT NULL DEFAULT 'PENDING',
    "document_sha256" TEXT NOT NULL,
    "signed_file_id" UUID,
    "requested_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "signature_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_signer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "membership_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "signer_status" NOT NULL,
    "signed_name" TEXT,
    "signed_at" TIMESTAMPTZ(6),
    "declined_at" TIMESTAMPTZ(6),
    "decline_reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "signature_signer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_file_storage_key_key" ON "stored_file"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "stored_file_tenant_id_id_key" ON "stored_file"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "employee_document_tenant_id_employee_id_status_idx" ON "employee_document"("tenant_id", "employee_id", "status");

-- CreateIndex
CREATE INDEX "employee_document_status_expires_on_idx" ON "employee_document"("status", "expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "employee_document_tenant_id_id_key" ON "employee_document"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "letter_template_tenant_id_name_key" ON "letter_template"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "signature_request_tenant_id_document_id_idx" ON "signature_request"("tenant_id", "document_id");

-- CreateIndex
CREATE INDEX "signature_request_status_expires_at_idx" ON "signature_request"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "signature_request_tenant_id_id_key" ON "signature_request"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "signature_signer_tenant_id_user_id_status_idx" ON "signature_signer"("tenant_id", "user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "signature_signer_request_id_position_key" ON "signature_signer"("request_id", "position");

-- AddForeignKey
ALTER TABLE "stored_file" ADD CONSTRAINT "stored_file_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "stored_file"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_template" ADD CONSTRAINT "letter_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "employee_document"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_signer" ADD CONSTRAINT "signature_signer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_signer" ADD CONSTRAINT "signature_signer_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "signature_request"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
