# 0012 — Double-entry books: approved journals, reversals, closed periods and payroll posting

- Status: accepted
- Date: 2026-10-20
- Builds on [ADR 0007](0007-approval-engine.md) (approval engine) and [ADR 0011](0011-payroll-and-indian-statutory-rules.md) (payroll)

## Decision

**One set of books per company.** Each company has its own chart of accounts (asset, liability, equity,
income, expense), created with a starting chart the first time anyone opens it. Accounts that payroll posts
to carry a system key (`BANK`, `SALARY_PAYABLE`, `PF_PAYABLE` …); they can be renamed or renumbered but not
archived. An account's type never changes once created, so past reports don't change meaning.

**Journals post only once approved.** A manual journal is drafted (date, narration, at least two one-sided
lines whose debits equal credits to the paisa), then sent to the approval engine as `journal_entry` with its
total as the amount, so policies can route by value. The preparer never approves their own journal and
nothing is approved automatically. Approval posts it: it gets the next number in the company's financial year
(`JV/2026-27/00001`, allocated under a per-company advisory lock) and becomes final.

**Posted means final, in the database.** Triggers (not just the API) enforce it: a journal starts as a draft;
lines can only be added, changed or removed while it is a draft; posting requires balanced lines, a matching
total, a number and a date after the books' closing date; a posted journal can change only to record which
journal reversed it, once; cancelled is final. Corrections are made by **reversal** — a mirror journal on a
date in open books, linked both ways — never by editing.

**Closing the books.** Configurers can close a company's books up to a date. Nothing can be posted on or
before it (the database checks this too), and closing is refused while drafts or journals waiting for
approval sit in the closed period. Closing and reopening are audited.

**Payroll posts itself.** When the `finance` feature is on, payroll emits domain events and finance posts
system journals, idempotently per run:

- on approval, the accrual — Dr salary expense (gross) and statutory expense (employer PF and ESI);
  Cr salaries payable (net), PF, ESI, professional tax, TDS and other deductions payable;
- on payment, Dr salaries payable, Cr bank.

These carry the payroll approval; they don't need a second one. If the run's date is in closed books, the
journal is dated the first open day so closed periods stay untouched.

**Reports are computed, not stored.** Trial balance, profit and loss, balance sheet (with unclosed profit
shown as current earnings, so it always balances) and account ledgers with opening and running balances are
calculated from posted lines in integer paise by pure, unit-tested functions.

## Consequences

- An approver doesn't need finance access to review a journal sent to them; they can open just that one.
- Receivables, payables, banking and tax returns build on these accounts in later phases.
- Year-end closing into retained earnings is not automatic yet; the balance sheet shows it as current earnings.
