# AI

Features `ai.assistant` (all plans) and `ai.governance` (usage report); limit `ai.tokens.monthly`. Server-side only.

- **Connection**: set `ANTHROPIC_API_KEY` on the API. `AI_MODEL` (default `claude-sonnet-5-5`) and `AI_MAX_OUTPUT_TOKENS` are optional. Without a key every AI call answers "AI isn't set up on this server". The key is never sent to the browser and never appears in an error. The provider sits behind a small interface (`ai/provider.ts`), so another provider can be added without touching the features.
- **Off by default**: each organisation's administrator (`settings.manage`) switches AI on for the organisation (`PUT /v1/ai/policy`). Until then every call is refused before anything is sent.
- **Budget**: each call is refused once the month's tokens reach the plan's `ai.tokens.monthly` (null means no limit). Overrides apply as for any limit.
- **What is recorded**: one usage row per request (who, which feature, model, token counts) and an audit event holding the token total and a short fingerprint of the question. Questions, answers and tool results are never stored.
- **Assistant** (`POST /v1/ai/assistant`): answers about the signed-in employee's own leave balances, open operations work and logged time. It uses read-only tools that run as the signed-in person, so their access rules apply. It cannot change, approve or send anything. Conversations are held in the browser only and sent back as history, at most ten turns.
- **Summaries** (`POST /v1/ai/summaries/operations-items/:id`): summarises an item's history for someone who can open it. If they can't open it, nothing is sent to the model.
- **Safety**: records and tool results are passed to the model as data, with instructions to ignore any commands inside them. A tool call the model invents is ignored. At most four rounds of tool use per question.
- **Tests** run against a stand-in for Anthropic's API, so no key or network is needed.
