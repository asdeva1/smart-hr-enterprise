# Assets (Phase 16, part C)

## What it does

- **Register**: every asset has a tag (the label stuck on the item), name, category, serial number, supplier,
  purchase date and cost, expected resale value and useful life in months. Assets belong to a company.
- **Giving out and taking back**: an asset is with one person at a time (enforced by the application and by a
  database trigger). Each hand-over records the condition; the full history is kept. An asset that comes back
  damaged can go straight to _Under repair_.
- **Retiring**: an asset that is not with anyone can be retired with a reason. It stays in the register but can
  no longer be changed or given out, and it stops depreciating on the retirement date.
- **Depreciation**: straight line, worked out when an asset is read, not stored. Cost less resale value is
  spread evenly over the useful life, one whole month at a time, in whole paise. A month counts once its
  day-of-month has been reached. After the useful life the book value stays at the resale value.
- **My assets**: every employee sees what has been given to them.

## Permissions

`assets.view` (register and history), `assets.manage` (add, give out, take back, retire, repair). Both can be
scoped to one company. The built-in _Accountant_ role holds both; _Auditor_ holds view. Needs the `assets` plan
feature (Pro and above).

## API

`/v1/assets` (list, create), `/v1/assets/mine`, `/v1/assets/people?search=` (a narrow employee search for the
give-out dialog: id, code and name only), `/v1/assets/:id` (detail with history, update), and
`/:id/assign`, `/:id/return`, `/:id/retire`.

## Not yet

Posting depreciation to the ledger, an exit checklist that prompts for assets still held, and vendor bills are
planned for later phases.
