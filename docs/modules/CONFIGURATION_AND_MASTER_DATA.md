# Organisation settings and master data

## Settings

Code: `packages/validation/src/settings.ts` (registry), `apps/api/src/tenant/` (API), `apps/web/src/app/admin/settings/` (screen).

Every setting is declared once in `ORGANISATION_SETTINGS` with a group, label, description, Zod schema, default and input type. Consequences:

- Unknown keys and invalid values are refused (`400`), on both `PUT /v1/tenant/configuration` (several at once, all-or-nothing) and the older one-key `PUT /v1/tenant/settings/:key`.
- Values are normalised by the schema (e.g. `usd` → `USD`) before they are stored.
- Modules read settings through `ConfigurationService.effective(tx)`, which always returns a complete, valid object: defaults fill gaps, and a stored value that no longer validates falls back to the default.
- Setting a value back to its default removes the stored row, so future default changes reach the organisation.
- Changing settings needs `settings.manage` **for the whole organisation**; a company-scoped grant isn't enough. Every member can read them (forms need date formats and currency).
- One audit event per save lists each changed key with its old and new value (settings hold no personal data).

| Key                          | Group   | Default        |
| ---------------------------- | ------- | -------------- |
| `timezone`                   | Locale  | `Asia/Kolkata` |
| `date_format`                | Locale  | `DD/MM/YYYY`   |
| `week_start`                 | Locale  | `MONDAY`       |
| `default_currency`           | Finance | `INR`          |
| `financial_year_start_month` | Finance | `4` (April)    |
| `employee_code_prefix`       | People  | `EMP`          |

Defaults suit an Indian organisation and are meant to be changed. Statutory values (tax slabs, PF/ESI ceilings, professional tax) are **not** settings: they are effective-dated rules arriving with payroll (Phase 14), never hard-coded.

Adding a setting: add it to the registry with a schema, default and input; the API, audit and screen pick it up. Removing one: stop reading it first, then delete it from the registry (stored rows are ignored).

## Master data (reference lists)

Code: `packages/shared/src/master-data.ts` (lists), `packages/validation/src/master-data.ts` (schemas), `apps/api/src/master-data/`, `apps/web/src/app/admin/master-data/`.

The lists are code — employment types, designations, grades and bands, cost centres, exit reasons, document categories — so modules can rely on them. Their values are tenant data in `lookup_value`.

- A value has a `code` (upper-case, unique within its list and organisation, **never changes**), a name, an optional description and a display order.
- Values are **archived, not deleted**, and an archived code stays taken, so records that used it keep their meaning. The database enforces this: the app role has no `DELETE` on the table and can update only name, description, order and status.
- Some lists offer suggested values; an administrator adds them with one click. Suggestions never overwrite an existing code and are never inserted automatically.
- Reading needs only membership; changing needs `master_data.manage` for the whole organisation. Every change is audited.
- Later modules reference values by id through tenant-qualified foreign keys (`(tenant_id, id)` is unique for this purpose).

## Tests

- `apps/api/test/configuration.int.test.ts` — defaults, normalisation, all-or-nothing validation, audit with before/after, tenant-wide permission (company-scoped refused), isolation; master data suggestions, uniqueness per list and organisation, archive/restore, audit trail, cross-organisation 404, and the database refusing code changes and deletes.
- `apps/web/e2e/configuration.spec.ts` — settings with validation and normalisation; reference list add, duplicate, edit, archive; suggestions once.

Mutation checks during development (each made a test fail): removing the tenant-wide check on either settings endpoint, removing value validation on the one-key endpoint, removing the tenant-wide check on master data.
