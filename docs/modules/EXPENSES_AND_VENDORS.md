# Expenses and vendors (Phase 16, part A)

## What it does

- **Vendors**: the supplier master (code, name, GSTIN, PAN, contact, payment terms). Shared by every company in
  the organisation. Vendors are archived, never deleted. Needs the `vendors` plan feature.
- **Expense categories**: Travel, Meals and so on. Each can require a receipt number and cap the amount of one
  expense.
- **Expense claims**: an employee lists expenses (date, category, what for, amount, receipt number). Claims are
  drafts until sent. Sending gives the claim a number (`EXP-000001`) and starts an approval of type
  `expense_claim`; by default the employee's reporting manager approves, and organisations can set their own
  policy (including amount thresholds). A claim sent back becomes a draft again with the approver's note and is
  resubmitted under the same number. Once approved, someone with `expenses.manage` marks it paid with a payment
  reference. Needs the `expenses` plan feature (Pro and above).

## Rules

| Rule | Where it is enforced |
| --- | --- |
| Lines are checked against the category (active, per-expense cap, receipt number, no future dates) | API |
| Only a draft can be edited; sent claims are locked | API |
| A claim is visible to its owner, people with `expenses.view` where the employee sits, and its approvers | API |
| Only an approved claim can be marked paid, and only once | API |
| Tenant isolation | Row-level security on all four tables |

## Permissions

`expenses.view`, `expenses.manage` (categories, mark paid), `vendors.view`, `vendors.manage`. The built-in
*Accountant* role has all four; *Auditor* has the two view permissions. Everyone with an employee record can file
their own claims.

## API

`/v1/expenses/categories`, `/v1/expenses/claims` (list with `scope=mine|all`, create, get, `PUT` while draft,
`/submit`, `/cancel`, `/pay`), `/v1/vendors`.

## Still to come in Phase 16

Part B: purchase requests, purchase orders and goods receipts. Part C: asset register, assignment and
depreciation. Posting expense payments to the ledger comes with them.
