# Procurement (Phase 16, part B)

## What it does

- **Purchase requests**: any employee asks for something to be bought (items, quantities, estimated prices).
  Sent for approval as `purchase_requisition`; the reporting manager approves by default. A request sent back
  returns to a draft and is resubmitted under the same number (`PR-000001`).
- **Purchase orders**: people with `procurement.manage` raise an order to an active vendor, optionally from an
  approved request. Tax is worked out per line in whole paise. Sending gives it a number (`PO-000001`) and
  starts a `purchase_order` approval at the company; the organisation owners approve by default and
  organisations can set amount-based policies.
- **Goods received**: against an approved order, in parts. Each receipt (`GRN-000001`) is kept as received;
  the order moves to _Partly received_ and then _Received_. Quantities can never exceed what is outstanding.

## Rules

| Rule                                                                            | Enforced by        |
| ------------------------------------------------------------------------------- | ------------------ |
| Only drafts can be edited; sent requests and orders are locked                  | API                |
| Only an approved request can be ordered; a cancelled or rejected order frees it | API                |
| Archived vendors can't be ordered from                                          | API                |
| An approved order that has received nothing can still be cancelled              | API                |
| Receipts are never edited or deleted                                            | database grants    |
| Tenant isolation                                                                | row-level security |

## Permissions

`procurement.view` (see requests and orders), `procurement.manage` (raise orders, send for approval, record
goods). The built-in _Accountant_ role holds both; _Auditor_ holds view.

## Still to come in Phase 16

Part C: asset register, assignment and depreciation. Vendor bills and posting purchases to the ledger follow.
