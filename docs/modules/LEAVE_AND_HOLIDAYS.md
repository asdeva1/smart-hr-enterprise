# Leave and holidays

Phase 10. Holiday calendars, leave types, balances and leave requests. Leave is recorded against employee
records (Phase 8) and feeds attendance (Phase 9): approved leave and holidays show in calendars, team views
and the monthly register instead of absences.

## Screens

| Screen           | Who                                                   | What                                                                                                     |
| ---------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| My leave         | Any member linked to an employee record               | Balances, apply for leave (with a live day count), my requests, holidays ahead                           |
| Leave request    | The employee, their managers, approvers, `leave.view` | Details, its approval, withdraw or cancel                                                                |
| Team             | Managers, `leave.view`                                | Who is away in the next four weeks; team requests by status                                              |
| Balances         | Managers, `leave.view`                                | Days available per person and leave type; bring everyone up to date (`leave.manage`, whole organisation) |
| Employee balance | Managers, `leave.view`                                | Balances and every change for a year; adjust and apply on their behalf (`leave.manage`)                  |
| Leave types      | `leave.configure` (whole organisation)                | Create, change and archive leave types                                                                   |
| Holidays         | `leave.configure` (for the calendar's place)          | Calendars for the organisation, companies and branches; add and remove holidays                          |

The module needs the `leave.basic` plan feature. Holidays also serve attendance, so the holiday screens and
API need `leave.basic` or `attendance.basic`.

## Holidays

- One calendar per place: the whole organisation, a company or a branch. An employee follows their branch's
  calendar, else their company's, else the organisation's. Archived calendars don't apply.
- Optional (restricted) holidays are listed but are working days unless someone takes leave.
- Adding, removing or changing a holiday, or archiving a calendar, recalculates attendance already worked out
  for the dates concerned.
- A database trigger checks that a calendar's place matches its unique scope key, so the "one per place" rule
  can't be bypassed.

## Leave types

| Setting                        | Meaning                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Credit                         | Yearly (all in January, pro-rated by month for joiners), monthly (a twelfth each month) or none (no balance, e.g. unpaid leave) |
| Days per year                  | Whole or half days                                                                                                              |
| Carry forward up to            | Unused days moved into the next year; the rest lapse                                                                            |
| Half days                      | Whether a one-day request can be a morning or an afternoon                                                                      |
| Weekly offs and holidays count | “Sandwich” rule: rest days inside a request count as leave                                                                      |
| Notice                         | Days ahead someone must apply for themselves (HR on their behalf is exempt)                                                     |
| Longest request                | Maximum days in one request                                                                                                     |

## Balances

A balance is the sum of an append-only ledger: grants, monthly accruals, carry-forward, lapses, adjustments,
leave taken and leave returned. The runtime database role can insert ledger entries but never change or
delete them, and a trigger checks that each kind moves the balance the right way and in whole or half days.

Credits are made automatically and idempotently the first time a balance is needed (viewing balances,
previewing or making a request): each automatic entry has a unique period key such as `2026` or `2026-03`,
so concurrent requests and repeated views never credit twice. "Bring balances up to date" does the same
for everyone at once. Carry-forward for a year is worked out once the previous year is over.

**Available** is the balance less leave waiting for approval.

## Requests

- Days are counted in the employee's own calendar: weekly offs (from their shift) and holidays are skipped
  unless the type counts them. A request that falls entirely on rest days is refused.
- Rules: joining and last working day, notice (for oneself), up to 60 days afterwards for oneself, longest
  request, half days, no overlap with open or approved leave, and enough available balance (types with a
  balance). Leave can't cross into a new year; split it.
- Requests go through the approval engine as “Leave request”. Until the organisation sets its own policy,
  they go to the employee's reporting manager, with the owners as the backstop.
- On approval the days are taken from the balance and attendance already worked out for those dates is
  recalculated. Rejected, sent-back and withdrawn requests change nothing.
- Whoever made an open request can withdraw it. Approved leave can be cancelled by the employee before it
  starts, or by someone with `leave.manage` where the employee sits at any time; the days are returned and
  attendance is recalculated.
- Someone with `leave.manage` can apply on an employee's behalf and adjust their balance, never their own.

## In attendance

A full day of leave shows as **On leave**. With half a day of leave, working the other half is a full day,
otherwise it's a half day; lateness or leaving early is only measured for the half meant to be worked. Weekly
offs and holidays stay what they are inside leave unless the type counts them. Work on a holiday is overtime.

## Not yet

- Encashment, leave without pay deductions and final settlement (Payroll, Phase 14).
- Compensatory off earned automatically from holiday work (adjust the balance for now).
- Leave policies that differ by company, grade or gender.
- Attachments such as medical certificates (Documents, Phase 12).

## Tests

`apps/api/src/leave/leave-calc.test.ts`, `apps/api/src/attendance/attendance-calc.test.ts` (holidays and leave
in a day), `apps/api/test/leave.int.test.ts`, `apps/web/e2e/leave.spec.ts`.
