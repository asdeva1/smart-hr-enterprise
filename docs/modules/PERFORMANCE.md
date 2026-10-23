# Performance management

Goals, review cycles, appraisals and colleague feedback. A plan feature (`performance`, in Premium and above, and in
the SmartHR Launch plan). Screens: **HR → Performance** (people with `performance.view` or `performance.manage`) or
**My work → Performance** (everyone else with an employee record).

## How a cycle runs

1. **HR sets up a cycle** for one company: a name and a period (`performance.manage`). Names are unique per company.
   People can already set goals while the cycle is in draft.
2. **HR opens the cycle.** A review is created for every current employee of that company who had joined by the end
   of the period. The reviewer is the person's manager at that moment (nobody, for someone with no manager; HR
   completes those).
3. **Goals.** Each person sets weighted goals for themselves; their manager or HR can set or change them too.
   Weights across a person's goals add up to 100 at most (dropped goals free their weight). Progress is 0 to 100.
   Removing a goal with no progress deletes it; otherwise it is marked dropped.
4. **Self review**, then **manager review**, then **acknowledgement**, always in that order. Ratings are 1 to 5 with a
   written comment. The manager can't review before the person has submitted theirs; a finished review can't be
   re-rated; a person can't review themselves.
5. **HR closes the cycle.** Goals and reviews freeze (a completed review can still be acknowledged).

## Who sees what

- A person sees their own goals and review. The manager's rating and comment reach them only once the review is
  complete.
- A reviewer sees the people they review. `performance.view` shows every review in a company; `performance.manage`
  also sets up, opens and closes cycles and can complete any review.
- Anyone else gets "not found", so nothing leaks.

## Feedback

Any employee can send praise or a suggestion to a current colleague at any time. Only the sender and the recipient
see it; notes can't be edited or deleted.

## Where the rules live

The API refuses wrong steps with plain messages, and the database enforces the same rules independently: cycles move
only draft → open → closed, an appraisal moves only through its steps and carries the right ratings at each, ratings
are 1 to 5, goal weights can't pass 100 (checked under a lock so two requests can't both slip through), a closed
cycle's goals and reviews can't change, and feedback is insert-only. Row-level security keeps every table inside its
organisation, and everything is part of the organisation's data export.

## Not built yet

Competency frameworks and rating scales per company, 360-degree reviews, calibration, review-linked pay revision,
and reminders or email notifications for pending steps.
