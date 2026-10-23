# Finance and accounting

Double-entry books for each company, with approved journals, reversals, closed periods, reports, and
automatic payroll postings. Requires the `finance` plan feature. Design: [ADR 0012](../decisions/0012-double-entry-books.md).

## Permissions

| Permission          | Allows                                            | System roles                      |
| ------------------- | ------------------------------------------------- | --------------------------------- |
| `finance.view`      | Chart of accounts, journals, ledgers and reports  | Accountant, Finance team, Auditor |
| `finance.manage`    | Draft, submit, cancel and reverse journals        | Accountant                        |
| `finance.configure` | Add and edit accounts; close and reopen the books | Accountant                        |

All are scope-checked against the company (tenant or company scope). Approvers named on a journal's
approval can open that journal without `finance.view`.

## Who sees what

The sidebar groups modules as My work, HR, Accounts & Finance, Operations and Administration. A group opens on
click and only appears when the member can use something in it. Organisation owners and the Organisation
administrator role hold every permission.

| Role               | Sees                                                                              |
| ------------------ | --------------------------------------------------------------------------------- |
| HR administrator   | HR only: employees, attendance, leave, documents, recruitment, onboarding         |
| Finance team       | Accounts & Finance: books, payroll, expenses, vendors, procurement                |
| Operations manager | Operations: departments and teams, projects, assets, inventory, operations spaces |

Everyone keeps their own self-service pages under My work (attendance, leave, approvals, expenses, payslips).

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

## Sales and receivables

Customers, GST invoices, quotations, proforma invoices, delivery challans and credit notes live under
`/v1/finance/sales/*` and use the same permissions as the books (`finance.view`, `finance.manage`,
`finance.configure` for the business details). Nothing is hard-deleted.

- **GST.** The seller's state comes from the company's business details (GSTIN or state code); the buyer's
  state from the customer or the document's place of supply. Same state: CGST + SGST; otherwise IGST. The
  arithmetic is shared by the API and the invoice screen (`packages/validation/src/sales-calc.ts`).
- **Numbers.** `INV/2026-27/0001`, `QTN/…`, `PI/…`, `DC/…`, `CN/…`, `RCT/…`; the financial year restarts on 1 April.
- **Posting.** Issuing an invoice posts Dr Accounts receivable / Cr Revenue and Output CGST/SGST/IGST; a
  credit note reverses it; a receipt posts Dr bank or cash / Cr Accounts receivable. Quotations, proformas
  and challans do not touch the books. The accounts are found by system key (`RECEIVABLES`, `SALES`,
  `GST_OUT_*`) and added to charts that predate them.
- **Corrections.** An issued invoice is never edited or cancelled: raise a credit note.
- **Receipts** settle the oldest open invoices first unless allocated by hand; any excess stays unapplied
  (the customer is in credit on their statement).
- **Reports.** Receivables summary, ageing by customer, and a customer statement with a running balance.

## Purchases and payables

Vendor bills and payments, booked to the company's books. Routes sit under `/v1/finance/purchases`; permissions reuse `finance.view`, `finance.manage` and `finance.configure`.

- **Bills and debit notes** start as drafts. Each line names the expense (or asset) account it is booked to, with an HSN or SAC code and a GST rate. Posting a bill gives it a number (`BILL/2026-27/0001`, debit notes `DN/…`) and journals: debit each expense account and the input GST accounts (1410/1420/1430); credit Payables (2000) for the total less TDS, and TDS payable (2250) for the TDS held back. GST splits into CGST and SGST within the state, IGST otherwise.
- **Debit notes** reverse a posted bill, in part or whole, and reduce what is owed on it.
- **Payments made** (`PAY/…`) debit Payables and credit the chosen bank or cash account. Without explicit allocations they settle the oldest bills by due date first. A bill's status moves to part paid or paid as the settled amount grows; a database check keeps settled at or below total less TDS.
- **Reports**: summary (owed, overdue, due in 7 days, paid this month), payables ageing by vendor, and a vendor ledger with a running balance.
- Posted bills cannot be edited; drafts can be changed or discarded. Posting is idempotent per bill and moves its date forward when the period is closed.
