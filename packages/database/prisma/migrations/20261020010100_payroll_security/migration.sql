-- Hand-written migration: row-level security, grants and integrity rules for payroll.

ALTER TABLE "pay_component" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pay_component"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "employee_salary" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_salary"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "employee_payroll" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_payroll"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "payroll_setting" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_setting"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "professional_tax_table" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "professional_tax_table"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "payroll_run" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_run"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "payslip" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payslip"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON "pay_component" TO app_rw;

-- Salary revisions are added, never rewritten or removed.
GRANT SELECT, INSERT ON "employee_salary" TO app_rw;

GRANT SELECT, INSERT, UPDATE ON "employee_payroll" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "payroll_setting" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "professional_tax_table" TO app_rw;

-- A run's company and month never change.
GRANT SELECT, INSERT ON "payroll_run" TO app_rw;
GRANT UPDATE ("status", "employee_count", "gross", "deductions", "net", "employer_cost", "approval_request_id",
              "calculated_at", "approved_at", "paid_at", "updated_at")
    ON "payroll_run" TO app_rw;

-- Draft payslips are recalculated in place and removed when someone leaves the draft.
GRANT SELECT, INSERT, DELETE ON "payslip" TO app_rw;
GRANT UPDATE ("employed_days", "lop_days", "lop_override", "paid_days", "earnings", "deductions", "employer",
              "adjustments", "gross", "total_deductions", "net", "employer_cost", "pf_wages", "esi_wages",
              "esi_covered", "taxable", "tds", "warnings", "updated_at")
    ON "payslip" TO app_rw;

-- Runs move forward: draft → waiting for approval → approved → paid. Paid and cancelled runs are final.
CREATE FUNCTION payroll_run_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF NEW."status" = OLD."status" THEN
            IF OLD."status" IN ('APPROVED', 'PAID', 'CANCELLED')
               AND (NEW."gross", NEW."deductions", NEW."net", NEW."employer_cost", NEW."employee_count")
                   IS DISTINCT FROM (OLD."gross", OLD."deductions", OLD."net", OLD."employer_cost", OLD."employee_count") THEN
                RAISE EXCEPTION 'payroll run %: totals are final once approved', OLD."id"
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END IF;
        IF OLD."status" IN ('PAID', 'CANCELLED')
           OR (OLD."status" = 'APPROVED' AND NEW."status" <> 'PAID')
           OR (NEW."status" = 'PAID' AND OLD."status" <> 'APPROVED')
           OR (NEW."status" = 'APPROVED' AND OLD."status" <> 'PENDING_APPROVAL') THEN
            RAISE EXCEPTION 'payroll run %: can''t go from % to %', OLD."id", lower(OLD."status"::text), lower(NEW."status"::text)
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER payroll_run_check
    BEFORE UPDATE ON "payroll_run"
    FOR EACH ROW EXECUTE FUNCTION payroll_run_guard();

-- Payslips change only while their run is a draft.
CREATE FUNCTION payslip_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
        run_status payroll_run_status;
    BEGIN
        SELECT r."status" INTO run_status FROM "payroll_run" r
            WHERE r."id" = COALESCE(NEW."run_id", OLD."run_id");
        IF run_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'payslip: the payroll run is %', lower(run_status::text)
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN COALESCE(NEW, OLD);
    END $$;

CREATE TRIGGER payslip_check
    BEFORE INSERT OR UPDATE OR DELETE ON "payslip"
    FOR EACH ROW EXECUTE FUNCTION payslip_guard();
