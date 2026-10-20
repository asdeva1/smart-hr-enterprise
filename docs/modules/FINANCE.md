# Finance and accounting

Double-entry books for each company, with approved journals, reversals, closed periods, reports, and
automatic payroll postings. Requires the `finance` plan feature. Design: [ADR 0012](../decisions/0012-double-entry-books.md).

## Permissions

| Permission          | Allows                                            | System roles        |
| ------------------- | ------------------------------------------------- | ------------------- |
| `finance.view`      | Chart of accounts, journals, ledgers and reports  | Accountant, Auditor |
| `finance.manage`    | Draft, submit, cancel and reverse journals        | Accountant          |
| `finance.configure` | Add and edit accounts; close and reopen the books | Accountant          |

All are scope-checked against the company (tenant or company scope). Approvers named on a journal's
approval can open that journal without `finance.view`.

## Chart of accounts

The starting chart (codes 1000–5300) covers cash, bank, receivables, employee advances, payables, payroll
liabilities, share capital, retained earnings, revenue and salary and statutory expense. Add accounts with a
code (digits, capitals, dots or hyphens), a name and a type. Archived accounts stay in reports but can't be
used on new journals.

## Journals

1. **Draft** — date, narration, two or more lines; each line is a debit or a credit, and the totals must match.
2. **Send for approval** — goes to the `journal_entry` approval policy (default: organisation owners).
3. **Posted** — numbered `JV/<financial year>/<sequence>` and final.
4. **Reverse** — posts a mirror journal on a date you choose in open books; both are linked.

Drafts can be edited or cancelled; a journal waiting for approval can be withdrawn from the approval.

## Payroll postings

With finance on, an approved payroll run posts its accrual and marking it paid posts the bank payment.
Each run posts once, whatever happens.

## Reports

Trial balance (as at), profit and loss (period; from defaults to 1 April), balance sheet (as at) and
account ledgers. Only posted journals count.

## Closing the books

Finance → Close the books. Choose the last closed date; every journal on or before it must already be posted
or cancelled. Reopening is allowed and audited.

## API

`/v1/finance/accounts`, `/accounts/:id/ledger`, `/journals` (+ `/:id/submit|cancel|reverse`),
`/reports/trial-balance|profit-and-loss|balance-sheet`, `/books/:companyId`. See the OpenAPI document.

## Tests

`ledger-calc.test.ts` (arithmetic), `finance.int.test.ts` (approval, DB guards, reports, payroll postings,
closing and reversal, plan gating), `e2e/finance.spec.ts` (draft → approve → ledger and reports).
