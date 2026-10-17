-- CreateEnum
CREATE TYPE "employee_change_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "employee_change_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "effective_date" DATE NOT NULL,
    "note" TEXT,
    "status" "employee_change_status" NOT NULL DEFAULT 'PENDING',
    "approval_request_id" UUID,
    "requested_by_user_id" UUID NOT NULL,
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_change_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_change_request_tenant_id_employee_id_status_idx" ON "employee_change_request"("tenant_id", "employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_change_request_tenant_id_id_key" ON "employee_change_request"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "employee_change_request" ADD CONSTRAINT "employee_change_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_change_request" ADD CONSTRAINT "employee_change_request_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
