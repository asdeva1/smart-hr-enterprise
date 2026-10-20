# Employee and manager self-service

Features `self_service.employee` and `self_service.manager`.

- **Home page** (`GET /v1/me/home`): today's attendance with a clock in/out button, things waiting for the person to approve, leave balances and pending requests, the next holiday, open work assigned to them (with overdue ones flagged), hours logged this week and assets they hold. Each section appears only if the plan includes that module and is built through the same service and permission checks as the module's own page, so it can't show more than the person could open themselves. A section that fails to load is left out rather than breaking the page.
- **Team today** (`GET /v1/me/team`, managers): how many of the people the person can see are in, on leave, late or not in yet, who is not in, who is on leave, and how many leave requests are waiting. Scope follows the attendance and leave permissions (reporting line, or the scopes of `attendance.view` and `leave.view`).
- Plans without `self_service.employee` get a plain welcome and the menu.
