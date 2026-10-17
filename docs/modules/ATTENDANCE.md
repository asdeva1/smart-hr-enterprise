# Attendance

Phase 9. Clock-ins, shifts, daily status and corrections. Attendance is recorded against employee records
(Phase 8), so clocking in needs a sign-in account linked to an employee. The module needs the
`attendance.basic` plan feature.

## Screens

| Screen           | Who                                          | What                                                                                             |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| My attendance    | Any member linked to an employee record      | Clock in and out, today's shift and times, month calendar, my corrections                        |
| Team             | Managers, `attendance.view`                  | One day for the people they can see; record a clock-in on someone's behalf (`attendance.manage`) |
| Monthly register | Managers, `attendance.view`                  | Status per person per day, with present, half-day, absent and late totals                        |
| Shifts           | `attendance.configure` / `attendance.manage` | Create and edit shifts, set the default, assign a shift from a date                              |
| Correction       | The requester and approvers                  | One correction with its approval; the requester can withdraw it while open                       |

Managers see their whole reporting line (direct and indirect reports) without any permission. Anyone else
sees the companies, branches or departments where they hold `attendance.view`.

## How a day is worked out

- **Time zone.** Every rule runs in the employee's own time zone (their branch's, else their company's).
- **Shifts.** Start and end time, break, grace for lateness, and the hours needed for a half and a full day,
  plus weekly offs. An end before the start means the shift runs past midnight; clock-ins up to four hours
  after such a shift ends still count towards the day it started. With no shift assigned, the
  organisation's default shift applies, and without one a built-in General shift (09:00–18:00, 1 hour break,
  10 minutes grace, Sunday off).
- **Worked time** is the sum of each clock-in to the next clock-out. A clock-in with no clock-out counts
  only for the current day, up to now.
- **Status.** Present at the full-day hours, half day at the half-day hours, otherwise absent. Someone
  clocked in today counts as present until the day ends. Weekly offs are shown as such; working on one
  counts as present and every minute is overtime.
- **Late and early.** Late is measured from the shift start once arrival passes the grace period. Leaving
  early is measured from the shift end. Overtime is time worked beyond the shift length less the break.
- **Assigning a shift from a past date** recalculates every day already worked out since then.

## Corrections

An employee who forgot to clock in or out, or whose reader failed, asks for a correction for a past day
(at most 60 days back, never in the future, one open correction per day). It goes through the approval
engine as an “Attendance correction”. Until the organisation sets its own policy, it goes to the employee's
reporting manager, and to the owners when there is no manager who can sign in. Approval adds the corrected
times as clock-ins marked “correction” and recalculates the day. Rejected and withdrawn corrections change
nothing. A new approver rule, **Reporting manager** (one to three levels up), is available to every policy.

## Data rules

- Every attendance table has tenant row-level security.
- Clock-ins are append-only: the runtime role has no update or delete on them. Mistakes are fixed by a
  correction, which adds clock-ins and keeps the originals.
- Shifts are archived, never deleted, and a database trigger refuses impossible times and thresholds.
- A decided or withdrawn correction can't be changed again (database trigger).
- Clock-ins are serialised per employee, so two quick clicks can't both clock in.
- Attendance data is included in the organisation's data export.

## Not yet

- Biometric devices, geofencing and mobile clock-in.
- Holidays (Phase 10) and leave (Phase 10) on the calendar; until then a holiday shows as absent.
- Rosters, overtime approval and regularisation rules beyond corrections (`attendance.advanced`).

## Tests

`apps/api/src/attendance/attendance-calc.test.ts` (time zones, night shifts, lateness, half days,
overtime), `apps/api/test/attendance.int.test.ts`, `packages/database/test/org-rls.int.test.ts`
(append-only clock-ins, shift and correction guards), `apps/web/e2e/attendance.spec.ts`.
