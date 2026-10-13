# Approvals and notifications

Shared services every business module uses. A module never builds its own approval flow or sends its own email.

## Approval engine

Code: `apps/api/src/approvals/`. Decision record: [ADR 0007](../decisions/0007-approval-engine.md).

### How a module uses it

1. Register a handler at start-up for its subject type (from `APPROVAL_SUBJECTS` in `@smart-hr/shared`):

   ```ts
   registry.register('leave_request', {
     onApproved: (tx, request) => leave.markApproved(tx, request.subjectId),
     onRejected: (tx, request, comment) => leave.markRejected(tx, request.subjectId, comment),
     onReturned: …, onCancelled: …,
   });
   ```

2. Inside the transaction that creates the record, call
   `engine.submit(tx, actor, { subjectType, subjectId, title, amount?, currency?, scope }, meta)`.
   The record and its approval commit together; hooks run inside the deciding transaction, so they can't disagree.

There is exactly one approval request per subject (`unique (tenant, subject_type, subject_id)`); a returned request is resubmitted, not recreated.

### Policies

One active, versioned policy per subject type and organisation, edited at **Administration → Approval policies** (`approvals.manage`). Publishing creates a new version; requests in progress keep the version they started with. With no policy, a default version is created on first use: _organisation owners approve_.

A policy is an ordered list of stages:

| Field        | Meaning                                                                              |
| ------------ | ------------------------------------------------------------------------------------ |
| `mode`       | `ANY` — first approval completes the stage; `ALL` — every assigned approver approves |
| `approvers`  | Rules: a role, a permission, a named member, or the owners                           |
| `minAmount`  | Stage runs only when the request amount is at least this (exact decimal)             |
| `dueInHours` | After this the approver is reminded and owners alerted (see escalation)              |

Approvers are resolved when a stage starts, for the request's scope: a role or permission assignment counts only if its scope covers the request (whole organisation, or the request's company, branch or department chain).

### Rules the engine enforces

- **Nobody approves their own request**, directly or as a delegate.
- **Distinct approvers** (on by default): someone who approved one stage isn't assigned a later one in the same round.
- **Owners are the fallback** when a stage's rules find nobody; if even that finds nobody the submit fails with `NO_APPROVER`, never auto-approves.
- **Decisions are serialised per request** (`SELECT … FOR UPDATE`), so two approvers acting at once can't both complete a stage. Tested by forcing the race.
- Reject and send-back need a reason, which the requester sees.
- Only the assignee can decide a task; anyone else gets 404, as for a task that doesn't exist.
- **Nothing is ever decided automatically.** Escalation only notifies. AI features (Phase 20) may recommend; they never approve.

### Delegation

A member can hand new approvals to a colleague for up to 90 days (Account → _Approvals while you're away_). Tasks created during that window go to the delegate and are marked as delegated; tasks already waiting stay with the original approver. A delegate never receives a task for their own request.

### Visibility

| Who                                         | Sees                 |
| ------------------------------------------- | -------------------- |
| Requester                                   | Their requests       |
| Assignee (incl. delegate)                   | Requests they act on |
| `approvals.view_all` at a scope covering it | Every request there  |
| Everyone else, and every other organisation | Nothing (404)        |

## Notifications

Code: `packages/database/src/notifications.ts` (writer), `apps/api/src/notifications/` (API), `apps/worker/src/notifications/` (delivery).

- `createNotifications(tx, tenantId, …)` writes in-app rows **in the caller's transaction**. If the person's preference (or the category default) says so, the row is also marked for email.
- The notification table is the **email outbox**. The worker's outbox sweep claims pending rows across organisations through `claim_email_notifications` (SECURITY DEFINER, `FOR UPDATE SKIP LOCKED`), sends them, and records the result with `complete_email_notification`. Sent rows drop their text. Failed sends are retried after the claim window (5 minutes) up to `EMAIL_MAX_ATTEMPTS`, then marked `FAILED`. A crash between sending and recording can cause at most one duplicate email.
- Row-level security: a person reads and marks read **only their own** notifications; the app role can't change delivery columns directly.
- Categories and email defaults live in `NOTIFICATION_CATEGORIES` (`@smart-hr/shared`). People change email per category on their account page; in-app notifications are always on.

### Escalation

The worker's escalation sweep claims overdue tasks (`claim_overdue_approval_tasks`, which stamps `escalated_at` so each task escalates once) and, in the same transaction and under the task's own tenant context, notifies the approver (`approval.overdue`, emailed by default) and the other owners (`approval.escalated`, in-app by default).

### Worker settings

| Variable                          | Default   | Meaning                            |
| --------------------------------- | --------- | ---------------------------------- |
| `EMAIL_SWEEP_INTERVAL_MS`         | 15000     | Outbox delivery interval; 0 = off  |
| `EMAIL_MAX_ATTEMPTS`              | 5         | Attempts before an email is FAILED |
| `APPROVAL_ESCALATION_INTERVAL_MS` | 300000    | Overdue check interval; 0 = off    |
| `APP_PUBLIC_URL`                  | localhost | Base for links in emails           |

## API

| Method and path                                               | Who                    |
| ------------------------------------------------------------- | ---------------------- |
| `GET /v1/approvals/inbox`                                     | Any member             |
| `GET /v1/approvals/requests?view=mine\|all`                   | Any member / view_all  |
| `GET /v1/approvals/requests/:id`                              | Involved or view_all   |
| `POST /v1/approvals/tasks/:id/decision`                       | The assignee           |
| `POST /v1/approvals/requests/:id/cancel`                      | The requester          |
| `POST /v1/approvals/requests/:id/resubmit`                    | The requester          |
| `GET, POST /v1/approvals/policies`                            | `approvals.manage`     |
| `GET, POST, DELETE /v1/approvals/delegations`                 | Any member (their own) |
| `GET /v1/approvals/colleagues`                                | Any member (names)     |
| `GET /v1/notifications`, `POST …/:id/read`, `POST …/read-all` | Their own              |
| `GET, PUT /v1/notifications/preferences`                      | Their own              |

## Tests

- `apps/api/test/approvals.int.test.ts` — engine flows, thresholds, ALL/ANY, separation of duties, versions, delegation, forced concurrent decisions, visibility across members and organisations, notification RLS and preferences.
- `apps/worker/test/sweeps.int.test.ts` — outbox delivery across organisations, retry and give-up, direct-update denial, escalation once per task.
- `apps/web/e2e/approvals.spec.ts` — bell → request → send back (email to the requester via the worker and Mailpit), approve from inbox, policy editor, email preferences and delegation.

Mutation checks run during development (each made a test fail): removing the requester exclusion, the assignee check, distinct approvers, the amount threshold, the request lock, the notification recipient policy, and the escalation tenant switch.
