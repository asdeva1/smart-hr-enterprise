-- Hand-written migration: row-level security, grants and double-entry integrity for the books.

ALTER TABLE "ledger_account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ledger_account"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "journal_entry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "journal_entry"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "journal_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "journal_line"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "book_lock" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "book_lock"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Accounts keep their company and type once created (their history depends on it).
GRANT SELECT, INSERT ON "ledger_account" TO app_rw;
GRANT UPDATE ("code", "name", "system_key", "description", "status", "updated_at") ON "ledger_account" TO app_rw;

GRANT SELECT, INSERT ON "journal_entry" TO app_rw;
GRANT UPDATE ("number", "date", "narration", "status", "total", "approval_request_id", "reversed_by_id",
              "posted_at", "updated_at")
    ON "journal_entry" TO app_rw;

-- Lines are rewritten only while their journal is a draft (enforced below).
GRANT SELECT, INSERT, UPDATE, DELETE ON "journal_line" TO app_rw;

-- Reopening the books fully removes the lock (finance.configure; audited).
GRANT SELECT, INSERT, UPDATE, DELETE ON "book_lock" TO app_rw;

-- Each line is a debit or a credit, never both, never negative.
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_one_side"
    CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0) <> ("credit" > 0)));

-- Journals start as drafts. A posted journal balances, has a number, is outside closed books, and from then
-- on only its reversal link may be set. Cancelled journals are final.
CREATE FUNCTION journal_entry_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
        debits numeric;
        credits numeric;
        line_count integer;
        locked date;
    BEGIN
        IF TG_OP = 'INSERT' THEN
            IF NEW."status" <> 'DRAFT' THEN
                RAISE EXCEPTION 'journal %: must start as a draft', NEW."id" USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END IF;
        IF OLD."status" = 'CANCELLED' THEN
            RAISE EXCEPTION 'journal %: cancelled', OLD."id" USING ERRCODE = 'check_violation';
        END IF;
        IF OLD."status" = 'POSTED' THEN
            IF (NEW."number", NEW."date", NEW."narration", NEW."status", NEW."total", NEW."posted_at")
               IS DISTINCT FROM (OLD."number", OLD."date", OLD."narration", OLD."status", OLD."total", OLD."posted_at")
               OR (OLD."reversed_by_id" IS NOT NULL AND NEW."reversed_by_id" IS DISTINCT FROM OLD."reversed_by_id") THEN
                RAISE EXCEPTION 'journal %: posted journals can''t be changed; reverse it instead', OLD."id"
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END IF;
        IF NEW."status" = 'POSTED' THEN
            SELECT coalesce(sum(l."debit"), 0), coalesce(sum(l."credit"), 0), count(*)
                INTO debits, credits, line_count
                FROM "journal_line" l WHERE l."entry_id" = NEW."id";
            IF line_count < 2 OR debits <> credits OR debits = 0 THEN
                RAISE EXCEPTION 'journal %: doesn''t balance (debits %, credits %)', NEW."id", debits, credits
                    USING ERRCODE = 'check_violation';
            END IF;
            IF NEW."total" <> debits THEN
                RAISE EXCEPTION 'journal %: total doesn''t match its lines', NEW."id" USING ERRCODE = 'check_violation';
            END IF;
            IF NEW."number" IS NULL OR NEW."posted_at" IS NULL THEN
                RAISE EXCEPTION 'journal %: posted without a number', NEW."id" USING ERRCODE = 'check_violation';
            END IF;
            SELECT b."locked_until" INTO locked FROM "book_lock" b WHERE b."company_id" = NEW."company_id";
            IF locked IS NOT NULL AND NEW."date" <= locked THEN
                RAISE EXCEPTION 'journal %: the books are closed up to %', NEW."id", locked
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
        RETURN NEW;
    END $$;

CREATE TRIGGER journal_entry_check
    BEFORE INSERT OR UPDATE ON "journal_entry"
    FOR EACH ROW EXECUTE FUNCTION journal_entry_guard();

CREATE FUNCTION journal_line_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
        entry_status journal_status;
    BEGIN
        SELECT e."status" INTO entry_status FROM "journal_entry" e
            WHERE e."id" = COALESCE(NEW."entry_id", OLD."entry_id");
        IF entry_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'journal line: the journal is %', lower(entry_status::text)
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN COALESCE(NEW, OLD);
    END $$;

CREATE TRIGGER journal_line_check
    BEFORE INSERT OR UPDATE OR DELETE ON "journal_line"
    FOR EACH ROW EXECUTE FUNCTION journal_line_guard();
