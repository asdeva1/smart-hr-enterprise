-- Hand-written migration: row-level security and grants for AI usage. The record only ever grows.

ALTER TABLE "ai_usage_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_usage_event"
    FOR ALL USING ("tenant_id" = app_current_tenant_id()) WITH CHECK ("tenant_id" = app_current_tenant_id());

GRANT SELECT, INSERT ON "ai_usage_event" TO app_rw;

ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_tokens" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0);
