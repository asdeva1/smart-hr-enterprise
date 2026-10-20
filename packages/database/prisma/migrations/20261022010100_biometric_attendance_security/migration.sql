-- Hand-written migration: row-level security, grants and the device lookup for biometric attendance.

ALTER TABLE "biometric_device" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "biometric_device"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "biometric_enrollment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "biometric_enrollment"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "biometric_log" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "biometric_log"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Devices are archived, never deleted. Links can be removed and re-made. Scans are kept as received; only
-- what became of them can change.
GRANT SELECT, INSERT, UPDATE ON "biometric_device" TO app_rw;
GRANT SELECT, INSERT, DELETE ON "biometric_enrollment" TO app_rw;
GRANT SELECT, INSERT ON "biometric_log" TO app_rw;
GRANT UPDATE ("outcome", "employee_id") ON "biometric_log" TO app_rw;

-- A machine identifies itself by serial number alone, with no session, so the API must find its organisation
-- before it can act inside it. This returns that one row and nothing else, and only for active devices.
CREATE FUNCTION biometric_device_lookup(p_serial text)
    RETURNS TABLE (tenant_id uuid, device_id uuid, time_zone text, attlog_stamp text)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
        SELECT d."tenant_id", d."id", d."time_zone", d."attlog_stamp"
        FROM "biometric_device" d
        WHERE d."serial_number" = p_serial AND d."status" = 'ACTIVE'
        LIMIT 1
    $$;

REVOKE ALL ON FUNCTION biometric_device_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION biometric_device_lookup(text) TO app_rw;
