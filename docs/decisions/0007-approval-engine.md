# 0007 — One approval engine, transactional notifications

- Status: accepted
- Date: 2026-10-13

## Decision

All approvals (leave, attendance corrections, expenses, purchases, payments, journals, hiring, payroll, operations changes) go through one engine in the API. Modules submit inside their own transaction and react through registered hooks that run inside the deciding transaction. Policies are tenant data: versioned, ordered stages with ANY/ALL approval, role/permission/member/owner rules resolved for the request's scope, optional amount thresholds and due times.

Notifications are rows written in the same transaction as the change that causes them. The notification table doubles as the email outbox; the worker delivers from it through narrow SECURITY DEFINER claim/complete functions.

## Why

- One engine gives every module the same controls — separation of duties, distinct approvers, serialised decisions, audit — instead of a dozen partial copies.
- Hooks in the same transaction mean a leave request can never be "approved" while its approval is pending, or the reverse.
- An outbox in the database means an email is exactly as durable as the change: no email for a rolled-back change, no lost email if Redis is down when the change commits. Redis queues stay for jobs that don't need that guarantee.
- Versioned policies keep in-flight requests stable and make "who should have approved this?" answerable later.

## Consequences

- Each module registers a handler and submits with a scope; it never writes approval rows itself.
- Email delivery latency is the sweep interval (15 s by default). If volume grows, add a Redis nudge on commit; the outbox stays the source of truth.
- Escalation only notifies. Automatic approval, rejection or reassignment after a timeout is deliberately not supported.
