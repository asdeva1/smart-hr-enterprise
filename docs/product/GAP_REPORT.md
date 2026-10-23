# Gap report against the master prompt

Written 24 October 2026 from a read of the code (nothing was run, so "built" means the code is present).
Status: BUILT, PARTIAL or NOT_FOUND.

| # | Item | Status | Evidence | Missing |
|---|---|---|---|---|
| 1 | Biometric connector, raw punches, device sync | BUILT (one protocol) | `apps/api/src/attendance/biometric-ingest.service.ts`, `biometric.controller.ts`, `docs/BIOMETRIC.md` | Only eSSL/ZKTeco ADMS push. No pull SDK, other vendors, device user push or enrolment, or per-device auth beyond the serial number |
| 2 | Mobile attendance, geofence, selfie | NOT_FOUND | `AttendancePunch` has no location or photo field | Mobile app, geofence, selfie |
| 3 | Project connectors; native projects | PARTIAL | `Project`, `ProjectMember`, `TimeEntry`, `projects.controller.ts` | No Jira, Asana, Zoho, Trello, ClickUp. No tasks, milestones, cost actuals or invoicing link |
| 4 | Refrens integration | NOT_FOUND | none | Everything |
| 5a | Gateway for subscription billing | PARTIAL | `billing/razorpay.provider.ts`, `checkout.service.ts`, signed webhook | Razorpay one-time orders at sign-up only. No renewals, proration, dunning, Cashfree or Stripe |
| 5b | Customer invoice payment links | NOT_FOUND | `CustomerReceipt` is manual | Payment links, online payment, gateway reconciliation |
| 6 | Public API | PARTIAL | `integrations/*`, `webhook-delivery.service.ts` | One scope and one endpoint, 4 webhook events. No API-key rate limit, idempotency keys or published OpenAPI |
| 7 | Integrations directory, OAuth | NOT_FOUND | `/admin/integrations` is webhooks and API keys only | Directory, OAuth, connector store |
| 8 | AI assistant and governance | BUILT | `ai/*`, `AiUsageEvent`, `/assistant`, `/admin/ai` | Prompt audit review, PII controls, per-role access, model allow-list |
| 9 | Learning, surveys, helpdesk, travel, advances | PARTIAL | Generic operations workspace and expenses | Training, surveys, travel requests, advances; helpdesk only as a template |
| 10 | Reseller tenant type; controlled support access | NOT_FOUND | Single `isPlatformAdmin` flag | Partner tenants, time-boxed audited support access |
| 11 | Feature flags, release controls | PARTIAL | Plan entitlements and overrides | Runtime flags, rollouts, kill switches |
| 12 | SMS/WhatsApp, template management | PARTIAL | In-app and email with outbox | SMS, WhatsApp, template editor |
| 13 | Resume extraction, interviews, offers | PARTIAL | `Candidate.resumeFileId`, `Interview`, `JobOffer` | Resume parsing, candidate portal, offer sending, calendar invites |
| 14 | Payroll: loans, arrears, F&F, declarations | PARTIAL | `payroll/*` | Loans and advances, arrears, full and final, tax declarations, old regime, Form 16, 24Q |
| 15 | Sales order, recurring invoices, payment links | PARTIAL | `finance/sales.controller.ts` | Sales orders, recurring invoices, payment links, sales debit notes |
| 16 | Role dashboards | PARTIAL | `app/page.tsx`, `MyHome`, `TeamCard` | HR admin, payroll admin, project manager dashboards |
| 17 | MFA, session revocation | BUILT | `account-security.controller.ts`, `UserSession` | WebAuthn, SMS or email second factor |
| 18 | Retention and export on expiry | PARTIAL | `subscription-expiry.service.ts`, `tenant/export.controller.ts` | Retention schedule, expiry-triggered export, legal hold |

## Largest gaps

1. Subscription billing is a one-time checkout; renewals are manual.
2. No customer invoice payment links, sales orders or recurring invoices.
3. The public API is minimal and not rate limited or documented as OpenAPI.
4. No integrations directory, OAuth, project connectors or Refrens.
5. No mobile attendance; biometric covers one protocol.
6. No partner tenants or controlled support access.
7. Payroll compliance gaps (loans, arrears, F&F, declarations, Form 16).
8. No learning, surveys, helpdesk, travel, SMS/WhatsApp, candidate portal or role dashboards.
