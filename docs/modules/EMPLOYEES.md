# Employees

Phase 8. Employee records are separate from sign-in accounts. An employee can exist without ever signing in,
and a member can sign in without an employee record (an external auditor, say). The two are linked when an
employee is invited to sign in.

## Screens

| Screen                       | Who                                    | What                                                                             |
| ---------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| Employees                    | `employees.view`                       | Directory with search, status filter and sorting, limited to the viewer's scopes |
| Add employee                 | `employees.manage`                     | Personal and job details, placement, manager; the code is automatic or typed     |
| Employee: Overview           | `employees.view`                       | Job, placement, manager and personal details; corrections via “Edit details”     |
| Employee: Change employment  | `employees.lifecycle`                  | Promotion, transfer, manager change, notice, withdraw notice, exit               |
| Employee: Identity and bank  | `employees.sensitive.view` / `.manage` | PAN, Aadhaar, bank account, IFSC, UAN; masked until revealed                     |
| Employee: Emergency contacts | `employees.view` / `.manage`           | Contacts, one marked primary                                                     |
| Employee: History            | `employees.view`                       | Joining and every lifecycle event, with effective dates                          |
| Org chart                    | `employees.view`                       | Reporting lines                                                                  |
| Import                       | `employees.manage`                     | CSV upload with a dry run that reports every problem before anything changes     |

## Rules

- **Who sees whom.** Lists and records are filtered to the scopes where the viewer holds `employees.view`:
  a company, a branch, or a department and its sub-departments. Tenant-wide holders and owners see everyone.
  Changes check the scope of both the current and, for transfers, the destination placement.
- **History is append-only.** Corrections (a misspelt name) use “Edit details”. Career changes use lifecycle
  actions, which write an event with an effective date. The database grants no update or delete on events.
- **Concurrent edits.** Every change carries the version it was based on; a stale version is refused, so two
  people can't silently overwrite each other.
- **Reporting lines.** Nobody can be their own manager (database rule), and longer loops are refused by the
  API, which walks the chain. An exit is refused while the person still has direct reports.
- **Exit.** Records the exit date and reason, keeps the record, and ends the linked sign-in access.
- **Reference values.** Designation, grade, employment type, cost centre and exit reason must come from the
  matching reference list; a database trigger refuses a value from the wrong list.
- **Plan.** The module needs the `hr.core` feature, and adding employees stops at the plan's `employees.max`.

## Identity and bank details

Stored encrypted with AES-256-GCM under a dedicated key ring (`DATA_ENCRYPTION_KEYS`, separate from the MFA
keys; the API refuses to start if the two share a key). Each value is bound to its organisation, employee and
field, so a value copied to another row or column can't be decrypted. Screens and the API show the last four
characters only. Showing full numbers needs `employees.sensitive.view`, a recent password entry, and is
written to the audit log. Personal values are never written into the audit log itself. The owner's full data
export includes these details decrypted, because the export exists to hand the organisation its own data.

## Import

CSV, up to 2,000 rows, UTF-8 with a header row. Required columns: `first_name`, `last_name`,
`date_of_joining`, `company_code`. Optional: `employee_code`, `work_email`, `phone`, `date_of_birth`, `gender`,
`branch_code`, `department_code`, `designation_code`, `grade_code`, `employment_type_code`, `cost_centre_code`,
`manager_code` (another row in the file or an existing employee). Unknown or missing columns refuse the whole
file. Rows are imported in one transaction: all or nothing.

## API

All under `/v1/employees`, all requiring the `hr.core` plan feature.

| Method and path                        | Permission                                        |
| -------------------------------------- | ------------------------------------------------- |
| `GET /`, `GET /:id`, `GET /org-chart`  | `employees.view`                                  |
| `POST /`, `PATCH /:id`, `POST /import` | `employees.manage`                                |
| `POST /:id/lifecycle`                  | `employees.lifecycle`                             |
| `GET /:id/history`                     | `employees.view`                                  |
| `POST /:id/sign-in`                    | `employees.manage` and `access.manage`            |
| `GET /:id/sensitive`                   | `employees.sensitive.view` (masked)               |
| `POST /:id/sensitive/reveal`           | `employees.sensitive.view` + recent auth, audited |
| `PUT /:id/sensitive`                   | `employees.sensitive.manage` + recent auth        |
| `GET/POST/PUT/DELETE /:id/contacts…`   | `employees.view` / `employees.manage`             |

A new built-in role, **HR administrator**, holds every employee permission plus reference lists. Auditors
can view employees.

## Tests

`apps/api/test/employees.int.test.ts`, `packages/database/test/org-rls.int.test.ts` (isolation and the
lookup trigger), `packages/validation/src/employees.test.ts`, `packages/shared/src/permissions.test.ts`,
`apps/web/e2e/employees.spec.ts`.
