-- CreateEnum
CREATE TYPE "token_purpose" AS ENUM ('PASSWORD_RESET', 'INVITATION');

-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "scope_type" AS ENUM ('TENANT', 'COMPANY', 'BRANCH', 'DEPARTMENT');

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "require_mfa" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "password_reset_token" ADD COLUMN     "purpose" "token_purpose" NOT NULL DEFAULT 'PASSWORD_RESET';

-- CreateTable
CREATE TABLE "company" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "country" CHAR(2) NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" CHAR(2),
    "timezone" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission")
);

-- CreateTable
CREATE TABLE "role_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "scope_type" NOT NULL,
    "scope_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_membership_tenant_id_id_key" ON "tenant_membership"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "company_tenant_id_code_key" ON "company"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "company_tenant_id_id_key" ON "company"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "branch_tenant_id_company_id_idx" ON "branch"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_tenant_id_code_key" ON "branch"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "branch_tenant_id_id_key" ON "branch"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "department_tenant_id_company_id_idx" ON "department"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "department_tenant_id_parent_id_idx" ON "department"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_tenant_id_code_key" ON "department"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "department_tenant_id_id_key" ON "department"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_key_key" ON "role"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_id_key" ON "role"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "role_permission_tenant_id_idx" ON "role_permission"("tenant_id");

-- CreateIndex
CREATE INDEX "role_assignment_tenant_id_role_id_idx" ON "role_assignment"("tenant_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignment_membership_id_role_id_scope_type_scope_id_key" ON "role_assignment"("membership_id", "role_id", "scope_type", "scope_id");

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "department"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "role"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "role"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
