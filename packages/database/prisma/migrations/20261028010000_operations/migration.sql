-- CreateEnum
CREATE TYPE "ops_stage_kind" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ops_field_type" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "ops_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ops_event_kind" AS ENUM ('CREATED', 'EDITED', 'STAGE', 'ASSIGNED', 'COMMENT');

-- CreateTable
CREATE TABLE "ops_workspace" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "template" TEXT,
    "prefix" TEXT NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ops_workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_stage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "ops_stage_kind" NOT NULL DEFAULT 'OPEN',
    "position" INTEGER NOT NULL,

    CONSTRAINT "ops_stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_field" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "ops_field_type" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ops_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "stage_id" UUID NOT NULL,
    "priority" "ops_priority" NOT NULL DEFAULT 'NORMAL',
    "assignee_id" UUID,
    "due_date" DATE,
    "values" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ops_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_item_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "kind" "ops_event_kind" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "actor_name" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_item_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ops_workspace_tenant_id_id_key" ON "ops_workspace"("tenant_id", "id");
CREATE UNIQUE INDEX "ops_workspace_tenant_id_code_key" ON "ops_workspace"("tenant_id", "code");
CREATE UNIQUE INDEX "ops_stage_tenant_id_id_key" ON "ops_stage"("tenant_id", "id");
CREATE UNIQUE INDEX "ops_stage_workspace_id_key_key" ON "ops_stage"("workspace_id", "key");
CREATE UNIQUE INDEX "ops_field_workspace_id_key_key" ON "ops_field"("workspace_id", "key");
CREATE UNIQUE INDEX "ops_item_tenant_id_id_key" ON "ops_item"("tenant_id", "id");
CREATE UNIQUE INDEX "ops_item_workspace_id_number_key" ON "ops_item"("workspace_id", "number");
CREATE INDEX "ops_item_tenant_id_assignee_id_idx" ON "ops_item"("tenant_id", "assignee_id");
CREATE INDEX "ops_item_workspace_id_stage_id_idx" ON "ops_item"("workspace_id", "stage_id");
CREATE INDEX "ops_item_event_tenant_id_item_id_created_at_idx" ON "ops_item_event"("tenant_id", "item_id", "created_at");

-- AddForeignKey
ALTER TABLE "ops_workspace" ADD CONSTRAINT "ops_workspace_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ops_workspace" ADD CONSTRAINT "ops_workspace_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ops_stage" ADD CONSTRAINT "ops_stage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ops_stage" ADD CONSTRAINT "ops_stage_tenant_id_workspace_id_fkey" FOREIGN KEY ("tenant_id", "workspace_id") REFERENCES "ops_workspace"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ops_field" ADD CONSTRAINT "ops_field_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ops_field" ADD CONSTRAINT "ops_field_tenant_id_workspace_id_fkey" FOREIGN KEY ("tenant_id", "workspace_id") REFERENCES "ops_workspace"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ops_item" ADD CONSTRAINT "ops_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ops_item" ADD CONSTRAINT "ops_item_tenant_id_workspace_id_fkey" FOREIGN KEY ("tenant_id", "workspace_id") REFERENCES "ops_workspace"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ops_item" ADD CONSTRAINT "ops_item_tenant_id_stage_id_fkey" FOREIGN KEY ("tenant_id", "stage_id") REFERENCES "ops_stage"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ops_item" ADD CONSTRAINT "ops_item_tenant_id_assignee_id_fkey" FOREIGN KEY ("tenant_id", "assignee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ops_item_event" ADD CONSTRAINT "ops_item_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ops_item_event" ADD CONSTRAINT "ops_item_event_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "ops_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
