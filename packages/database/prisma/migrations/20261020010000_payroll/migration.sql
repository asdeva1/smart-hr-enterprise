-- CreateEnum
CREATE TYPE "pay_component_kind" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "payroll_run_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "pay_component" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "pay_component_kind" NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "pf_wage" BOOLEAN NOT NULL DEFAULT false,
    "esi_wage" BOOLEAN NOT NULL DEFAULT true,
    "prorate" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pay_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salary" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "annual_ctc" DECIMAL(14,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_salary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payroll" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "pf_enabled" BOOLEAN NOT NULL DEFAULT true,
    "pf_on_full_wages" BOOLEAN NOT NULL DEFAULT false,
    "esi_enabled" BOOLEAN NOT NULL DEFAULT true,
    "pt_state" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_setting" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "pf_enabled" BOOLEAN NOT NULL DEFAULT true,
    "esi_enabled" BOOLEAN NOT NULL DEFAULT true,
    "labour_code_wages" BOOLEAN NOT NULL DEFAULT true,
    "pf_establishment_id" TEXT,
    "esi_employer_code" TEXT,
    "tan" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_tax_table" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slabs" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "professional_tax_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "payroll_run_status" NOT NULL DEFAULT 'DRAFT',
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employer_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approval_request_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "calculated_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employed_days" INTEGER NOT NULL,
    "lop_days" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "lop_override" DECIMAL(5,1),
    "paid_days" DECIMAL(5,1) NOT NULL,
    "earnings" JSONB NOT NULL,
    "deductions" JSONB NOT NULL,
    "employer" JSONB NOT NULL,
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "gross" DECIMAL(14,2) NOT NULL,
    "total_deductions" DECIMAL(14,2) NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "employer_cost" DECIMAL(14,2) NOT NULL,
    "pf_wages" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "esi_wages" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "esi_covered" BOOLEAN NOT NULL DEFAULT false,
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tds" JSONB,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payslip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pay_component_tenant_id_id_key" ON "pay_component"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_component_tenant_id_code_key" ON "pay_component"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "employee_salary_tenant_id_employee_id_effective_from_idx" ON "employee_salary"("tenant_id", "employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salary_tenant_id_id_key" ON "employee_salary"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_payroll_tenant_id_employee_id_key" ON "employee_payroll"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_setting_tenant_id_company_id_key" ON "payroll_setting"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "professional_tax_table_tenant_id_state_key" ON "professional_tax_table"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "payroll_run_tenant_id_company_id_year_month_idx" ON "payroll_run"("tenant_id", "company_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_tenant_id_id_key" ON "payroll_run"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payslip_tenant_id_employee_id_idx" ON "payslip"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslip_tenant_id_id_key" ON "payslip"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payslip_run_id_employee_id_key" ON "payslip"("run_id", "employee_id");

-- AddForeignKey
ALTER TABLE "pay_component" ADD CONSTRAINT "pay_component_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salary" ADD CONSTRAINT "employee_salary_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salary" ADD CONSTRAINT "employee_salary_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payroll" ADD CONSTRAINT "employee_payroll_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payroll" ADD CONSTRAINT "employee_payroll_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_setting" ADD CONSTRAINT "payroll_setting_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_setting" ADD CONSTRAINT "payroll_setting_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_tax_table" ADD CONSTRAINT "professional_tax_table_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "company"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_tenant_id_run_id_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "payroll_run"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_tenant_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
