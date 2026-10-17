# 0011 — Payroll runs, approval, and Indian statutory rules as versioned code

- Status: accepted
- Date: 2026-10-20
- Builds on [ADR 0007](0007-approval-engine.md) (approval engine)

## Decision

**Runs.** Payroll is one run per company per month. A run is calculated straight away from each employee's
salary revision in force at month end, their days of employment, and loss of pay from attendance (absent = 1,
half day = 0.5, approved unpaid leave = 1 or 0.5). While it is a draft, payroll staff can override loss of
pay and add one-off pay or deduction lines; every change recalculates the run. Submitting recalculates once
more and sends it to the approval engine as `payroll_run`, with the net total as its amount. The person who
prepared it can't approve it, and nothing is approved automatically (no AI or rule finalises pay). Approval
makes the payslips final and tells employees; a run is then marked paid. Months go in order: once a month
is approved, earlier months can't be run and salary revisions can't start inside it — differences are paid
as one-off lines.

**Integrity in the database.** Run status moves only forward (draft ⇄ waiting → approved → paid; draft →
cancelled); approved, paid and cancelled runs keep their totals. Payslips can be inserted, changed or removed
only while their run is a draft. Salary revisions are insert-only.

**Statutory rules are code, not settings.** Income tax slabs, rebate and cess, PF and ESI rates and
ceilings are law. They live in `apps/api/src/payroll/statutory-in.ts`, keyed by financial year, with their
sources, and a run for a year without rules fails rather than guessing. Organisations choose only what is
theirs to choose: PF/ESI on or off per company, the labour-code wage rule, registrations, each employee's
PF/ESI participation and professional-tax state, and their own professional-tax tables (states change these
often; starting tables are provided to check).

**Rules implemented (FY 2025-26 and 2026-27).**

- Income tax, new regime: slabs, ₹75,000 standard deduction, section 87A rebate to ₹12 lakh with marginal
  relief, surcharge with marginal relief, 4% cess. Monthly TDS = (projected annual tax − TDS already
  deducted this year) ÷ months left, where the projection is pay so far + this month + this month's recurring
  pay for the rest of the year.
- PF: 12% employee on wages capped at ₹15,000 (full wages if the employee opts in), employer 12% split into
  pension 8.33% (always capped) and EPF; EDLI and admin 0.5%. From 21 November 2025, allowances beyond half
  of pay count as PF wages (Code on Social Security), on by default.
- ESI: 0.75% / 3.25%, rounded up, when ESI wages are up to ₹21,000 at the start of the April–September or
  October–March period; coverage lasts the period.
- Professional tax: by state slab, with a February amount where the state has one.

## Why

Payroll errors are expensive and legally exposed, so: people approve every run; the database, not just the
API, keeps approved pay from changing; and statutory figures come from one reviewed, dated table instead of
being re-entered by each organisation.

## Not covered (yet)

- The old tax regime and employee investment declarations (80C, HRA exemption, …), previous-employer income,
  Form 16 / 24Q returns. Employees are taxed under the new regime.
- Mid-month salary revisions split within a month (the revision in force at month end applies).
- ESI and professional-tax returns, LWF, gratuity and bonus provisions, full-and-final settlement.
- Payment through a bank API: the bank transfer list is a file for the bank's bulk upload.
