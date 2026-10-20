# Projects and timesheets

Feature `projects`; permissions `projects.view` and `projects.manage`.

- **Projects** belong to a company and have a code, client, billing rate per hour, optional budget in hours, dates, a status (active, on hold, completed, archived) and an optional project manager.
- **Team**: only people on a project can log time on it. Each member has a cost per hour. Someone who has logged time can't be removed.
- **Logging time**: any employee on an active project, for a day up to today, in hours (1.5 is an hour and a half). The database refuses a day over 24 hours, including when two requests arrive together.
- **Approval**: the project manager, or anyone with `projects.manage`, approves open time for a date range. A project manager can't approve their own hours. Approved time can't be changed or deleted by the application.
- **Profitability** (only for `projects.view` / `projects.manage`): revenue is billable minutes at the project rate; cost is every logged minute at each member's cost rate. Money is worked out in whole paise from minutes so totals add up exactly. Rates apply as they are now, not as they were when the time was logged.
- **Who sees what**: people with `projects.view` see every project in their company scope. A project manager sees their own project and its time but not the money. Team members see their own time and the projects they're on.
- Included in the organisation data export. Not available on the Lite plan.
