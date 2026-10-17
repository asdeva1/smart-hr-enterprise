-- Hand-written migration: row-level security, grants and integrity rules for documents and e-signatures.

ALTER TABLE "stored_file" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stored_file"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "employee_document" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_document"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "letter_template" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "letter_template"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "signature_request" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "signature_request"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "signature_signer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "signature_signer"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Files are written once and never changed or deleted by the application.
GRANT SELECT, INSERT ON "stored_file" TO app_rw;

-- A document's file and employee never change; archiving is how it leaves the record.
GRANT SELECT, INSERT ON "employee_document" TO app_rw;
GRANT UPDATE ("title", "category", "notes", "visible_to_employee", "expires_on", "expiry_notified_at",
              "status", "archived_at", "archived_by_user_id", "updated_at")
    ON "employee_document" TO app_rw;

GRANT SELECT, INSERT, UPDATE ON "letter_template" TO app_rw;

-- What was sent for signature, and the hash it was sent with, can't be rewritten.
GRANT SELECT, INSERT ON "signature_request" TO app_rw;
GRANT UPDATE ("status", "signed_file_id", "completed_at", "closed_at", "updated_at")
    ON "signature_request" TO app_rw;

-- Who was asked to sign can't be changed; only their answer is recorded.
GRANT SELECT, INSERT ON "signature_signer" TO app_rw;
GRANT UPDATE ("status", "signed_name", "signed_at", "declined_at", "decline_reason", "ip_address",
              "user_agent", "updated_at")
    ON "signature_signer" TO app_rw;

-- An archived document stays archived (its history and signatures are kept as they were).
CREATE FUNCTION employee_document_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF OLD."status" = 'ARCHIVED' AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'document %: archived', OLD."id" USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."status" = 'ARCHIVED' AND NEW."archived_at" IS NULL THEN
            RAISE EXCEPTION 'document %: archived without a time', OLD."id" USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER employee_document_check
    BEFORE UPDATE ON "employee_document"
    FOR EACH ROW EXECUTE FUNCTION employee_document_guard();

-- A closed signature request is final, and only a completed one has a signed copy.
CREATE FUNCTION signature_request_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF OLD."status" <> 'PENDING' THEN
            RAISE EXCEPTION 'signature request %: already %', OLD."id", lower(OLD."status"::text)
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."status" = 'COMPLETED' AND (NEW."signed_file_id" IS NULL OR NEW."completed_at" IS NULL) THEN
            RAISE EXCEPTION 'signature request %: completed without a signed copy', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."status" <> 'COMPLETED' AND NEW."signed_file_id" IS NOT NULL THEN
            RAISE EXCEPTION 'signature request %: only a completed request has a signed copy', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER signature_request_check
    BEFORE UPDATE ON "signature_request"
    FOR EACH ROW EXECUTE FUNCTION signature_request_guard();

-- A signature or a refusal is final, and a signature always carries the signer's typed name and time.
CREATE FUNCTION signature_signer_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
        IF OLD."status" IN ('SIGNED', 'DECLINED') THEN
            RAISE EXCEPTION 'signer %: already %', OLD."id", lower(OLD."status"::text)
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."status" = 'SIGNED' AND (NEW."signed_name" IS NULL OR NEW."signed_at" IS NULL) THEN
            RAISE EXCEPTION 'signer %: signed without a name and time', OLD."id"
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW."status" IN ('SIGNED', 'DECLINED') AND
           (SELECT r."status" FROM "signature_request" r WHERE r."id" = OLD."request_id") <> 'PENDING' THEN
            RAISE EXCEPTION 'signer %: the request is closed', OLD."id" USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER signature_signer_check
    BEFORE UPDATE ON "signature_signer"
    FOR EACH ROW EXECUTE FUNCTION signature_signer_guard();

-- The worker's daily sweep: organisations with documents to remind about or signature requests past their
-- deadline. Returns organisation ids only; the worker then works inside each organisation's context.
CREATE FUNCTION document_sweep_due(p_remind_days integer, p_limit integer)
    RETURNS TABLE (tenant_id uuid)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $$
        SELECT t.tenant_id FROM (
            SELECT d."tenant_id"
            FROM "employee_document" d
            WHERE d."status" = 'ACTIVE'
              AND d."expires_on" IS NOT NULL
              AND d."expiry_notified_at" IS NULL
              AND d."expires_on" <= (now() AT TIME ZONE 'UTC')::date + least(greatest(p_remind_days, 0), 365)
            UNION
            SELECT r."tenant_id"
            FROM "signature_request" r
            WHERE r."status" = 'PENDING' AND r."expires_at" IS NOT NULL AND r."expires_at" <= now()
        ) t
        LIMIT least(p_limit, 500)
    $$;

REVOKE ALL ON FUNCTION document_sweep_due(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_sweep_due(integer, integer) TO app_rw;
