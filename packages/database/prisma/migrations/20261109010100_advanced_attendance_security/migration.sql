-- Hand-written migration: row-level security, grants and integrity rules for advanced attendance.
ALTER TABLE "attendance_policy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_policy" FOR ALL
    USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
ALTER TABLE "work_location" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "work_location" FOR ALL
    USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
ALTER TABLE "roster_entry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roster_entry" FOR ALL
    USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());
ALTER TABLE "overtime_approval" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "overtime_approval" FOR ALL
    USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Locations are retired, not deleted. Roster entries can be cleared. Overtime decisions can be changed (the
-- latest decision stands) but not deleted.
GRANT SELECT, INSERT, UPDATE ON "attendance_policy" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "work_location" TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON "roster_entry" TO app_rw;
GRANT SELECT, INSERT, UPDATE ON "overtime_approval" TO app_rw;

ALTER TABLE "attendance_policy" ADD CONSTRAINT "attendance_policy_ranges_check" CHECK (
    "overtime_threshold_minutes" BETWEEN 0 AND 600 AND
    "overtime_round_minutes" IN (1, 5, 10, 15, 30, 60) AND
    ("overtime_daily_cap_minutes" IS NULL OR "overtime_daily_cap_minutes" BETWEEN 15 AND 960) AND
    ("max_corrections_per_month" IS NULL OR "max_corrections_per_month" BETWEEN 0 AND 60) AND
    ("max_correction_backdate_days" IS NULL OR "max_correction_backdate_days" BETWEEN 0 AND 365));
ALTER TABLE "work_location" ADD CONSTRAINT "work_location_geometry_check" CHECK (
    "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180 AND "radius_meters" BETWEEN 20 AND 50000);
ALTER TABLE "overtime_approval" ADD CONSTRAINT "overtime_approval_minutes_check" CHECK (
    "approved_minutes" >= 0 AND ("decision" = 'APPROVED' OR "approved_minutes" = 0));
ALTER TABLE "attendance_punch" ADD CONSTRAINT "attendance_punch_geo_check" CHECK (
    ("latitude" IS NULL) = ("longitude" IS NULL) AND
    ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)));
