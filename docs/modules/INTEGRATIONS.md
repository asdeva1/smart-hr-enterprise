# Integrations: webhooks and API keys

For an organisation's own systems. Needs the `integrations.custom` plan feature and the **settings.manage**
permission. Screen: Administration → Integrations.

## Webhooks (events out)

| Event                     | Sent when                                       | Data                                                  |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| `employee.created`        | A person is added (including a hired candidate) | `employeeId`, `employeeCode`                          |
| `employee.status_changed` | Notice, exit or return from the lifecycle form  | `employeeId`, `employeeCode`, `action`, `status`      |
| `leave.request.approved`  | Leave is fully approved                         | `requestId`, `employeeId`, `leaveType`, dates, `days` |
| `operations.item.created` | A work item is raised                           | `itemId`, `workspaceId`, `ref`                        |

Payloads carry ids and codes only, never names, contact, pay or titles. A receiver that needs more calls back
with an API key.

- **Queued with the change.** The event row is written in the same database transaction, so an event exists
  exactly when the change does.
- **Signed.** Each request has `webhook-id`, `webhook-timestamp` (seconds) and
  `webhook-signature: v1,<hex>`, where the signature is HMAC-SHA256 of `<id>.<timestamp>.<raw body>` with the
  endpoint's secret (`whsec_…`). Reject requests with an old timestamp and compare signatures in constant time.
  The same event id is used on every retry, so receivers can ignore repeats.
- **Secret shown once.** It is stored encrypted (bound to the organisation and endpoint). "New secret" replaces it
  at once.
- **Retries.** A non-2xx answer or no answer is retried after 1, 4, 16, 64 … minutes, up to 6 tries (setting
  `WEBHOOK_MAX_ATTEMPTS`), then marked failed. After 25 events in a row fail for good (`WEBHOOK_DISABLE_AFTER`)
  the endpoint is switched off; turning it on resets the count. A delivered event's payload is cleared.
- **Public addresses only.** https is required; localhost, private, link-local and cloud-metadata addresses are
  refused when the address is entered and again when connecting (so a name that later points inward is
  refused). Redirects are not followed and the receiver's reply is never read. `WEBHOOK_ALLOW_PRIVATE_HOSTS`
  exists for development and the worker refuses to start with it in production.
- Up to 10 active webhooks per organisation.

Sending runs in the worker (every 15 s) or, on serverless hosting, in the scheduled `webhooks` sweep
(`/api/cron?jobs=webhooks`; the five-minute GitHub schedule already runs every sweep, so events can arrive up to five minutes after the change). The worker needs `DATA_ENCRYPTION_KEYS` and
`DATA_ENCRYPTION_KEY_ID`, the same values as the API; without them events stay queued.

## API keys (data in)

`Authorization: Bearer shr_<prefix>_<secret>` on `GET /v1/integrations/api/...`.

- Shown in full once; only a hash is stored. Listed by their first characters, last-used time and expiry.
- Revoked, never deleted. Optional expiry in days. Every failure (unknown, wrong, expired, revoked) is the same
  `401 INVALID_API_KEY`.
- Work only on the routes under `/v1/integrations/api`, never on the app's own routes. They stop working if the
  plan no longer includes integrations.
- `employees.read` → `GET /v1/integrations/api/employees?page=&pageSize=&status=CURRENT|ALL`: id, code, name,
  work email, status, joining and last working dates, company/department/designation, manager code. No identity
  numbers, bank, pay, birth date, phone or documents.

Creating, changing and revoking are audited (`integrations.*`), without secrets.
