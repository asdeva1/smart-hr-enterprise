-- Hand-written migration: row-level security, grants and integrity rules for bank reconciliation.

ALTER TABLE "bank_statement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_statement"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "bank_statement_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_statement_line"
    FOR ALL
    USING ("tenant_id" = app_current_tenant_id())
    WITH CHECK ("tenant_id" = app_current_tenant_id());

-- Statements are never edited or deleted; only a line's matching can change.
GRANT SELECT, INSERT ON "bank_statement" TO app_rw;
GRANT SELECT, INSERT ON "bank_statement_line" TO app_rw;
GRANT UPDATE ("status", "journal_line_id", "matched_by_user_id", "matched_at", "note") ON "bank_statement_line" TO app_rw;

ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_one_side"
    CHECK (("deposit" > 0 AND "withdrawal" = 0) OR ("withdrawal" > 0 AND "deposit" = 0));
ALTER TABLE "bank_statement_line" ADD CONSTRAINT "bank_statement_line_match_state"
    CHECK (("status" = 'MATCHED') = ("journal_line_id" IS NOT NULL));
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_period_check" CHECK ("period_to" >= "period_from");

-- A statement line can only be matched to a posted journal line on the same bank account for the same amount
-- and direction: a deposit to a debit, a withdrawal to a credit.
CREATE FUNCTION bank_line_match_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    jl RECORD;
BEGIN
    IF NEW."journal_line_id" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT l."account_id", l."debit", l."credit", e."status" INTO jl
      FROM "journal_line" l JOIN "journal_entry" e ON e."id" = l."entry_id"
     WHERE l."id" = NEW."journal_line_id" AND l."tenant_id" = NEW."tenant_id";
    IF NOT FOUND THEN
        RAISE EXCEPTION 'bank line matched to an unknown journal line' USING ERRCODE = '23514';
    END IF;
    IF jl."status" <> 'POSTED' THEN
        RAISE EXCEPTION 'only a posted journal line can be matched' USING ERRCODE = '23514';
    END IF;
    IF jl."account_id" <> NEW."account_id" OR jl."debit" <> NEW."deposit" OR jl."credit" <> NEW."withdrawal" THEN
        RAISE EXCEPTION 'journal line does not match the bank line account, amount or direction' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER bank_line_match_check
    BEFORE INSERT OR UPDATE ON "bank_statement_line"
    FOR EACH ROW EXECUTE FUNCTION bank_line_match_guard();
