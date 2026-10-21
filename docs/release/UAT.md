# User acceptance test script

Run on staging with a fresh organisation and the test accounts below. Each row is pass or fail with the tester's
initials and date. Anything that fails is logged with the steps, the account used and a screenshot.

Accounts to prepare: organisation admin, HR manager, line manager, two employees (one in the manager's team),
finance approver, platform operator. Use the minimum role for each step; a step that only works as admin is a
finding.

| #   | Area                    | Steps                                                                         | Expected                                                                      |
| --- | ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Sign-in                 | Sign in, turn on MFA, sign out, sign in with a code; use "forgot password"    | Reset email arrives; old sessions end after reset                             |
| 2   | Organisation set-up     | Add legal entity, locations, departments, designations, leave types, holidays | Appear in pickers; duplicates refused                                         |
| 3   | Employees               | Create, edit, upload a document, change manager, move department              | History shows each change; org chart updates                                  |
| 4   | Roles                   | Give an employee a custom role, check what they can and cannot open           | Hidden menu items and refused direct URLs                                     |
| 5   | Onboarding              | Hire to day-one checklist, complete tasks                                     | Tasks reach assignees; progress shows                                         |
| 6   | Attendance              | Check in and out, regularise a missed punch, manager approves                 | Approval notification; records correct                                        |
| 7   | Leave                   | Apply, approve, reject, cancel; apply over balance                            | Balance moves; over-balance refused                                           |
| 8   | Payroll                 | Run a month for a small group, review, approve, publish payslips              | Totals match a hand calculation; employee sees own payslip only               |
| 9   | Expenses                | Submit with receipt, approve, reimburse                                       | Status trail complete                                                         |
| 10  | Recruitment             | Opening, candidate, stage moves, offer                                        | Stage history kept                                                            |
| 11  | Procurement and vendors | Request, approve, purchase order, receive goods                               | Approval chain follows configured limits                                      |
| 12  | Inventory and assets    | Receive stock, issue, return; assign an asset                                 | Quantities and holder correct                                                 |
| 13  | Projects                | Create, assign, log time                                                      | Time totals correct                                                           |
| 14  | Finance                 | Post an entry, view a report                                                  | Debits equal credits                                                          |
| 15  | Approvals               | Delegate while away, reassign, withdraw                                       | Delegate sees and acts; audit shows who                                       |
| 16  | Search                  | Find a person by name, code and email; a record the user may not see          | Allowed results only                                                          |
| 17  | Integrations            | Create an API key, call the employee feed; add a webhook, create an employee  | Signed delivery received; revoked key stops working                           |
| 18  | AI assistant            | With the organisation switched on, ask a question; switch off                 | Answers respect permissions; off means refused; usage counted without content |
| 19  | Notifications           | Trigger an approval and a leave decision                                      | In-app and email arrive once                                                  |
| 20  | Audit                   | Open the audit log for the actions above                                      | Every change present with actor and time                                      |
| 21  | Data export             | Export the organisation's data as admin                                       | Archive complete; non-admin refused                                           |
| 22  | Separation              | Sign in to a second organisation                                              | Nothing from the first is visible, by menu, search or URL                     |
| 23  | Devices                 | Repeat 6, 7 and 9 on a phone                                                  | Usable without sideways scrolling                                             |
| 24  | Accessibility           | Keyboard only through sign-in, leave application, one approval                | Reachable, visible focus, labelled fields                                     |

## Exit rule

No open defect that loses data, shows one organisation's data to another, pays the wrong amount or blocks sign-in.
Other defects are listed with an owner and a date. Sign-off by the business owner and the technical owner.
