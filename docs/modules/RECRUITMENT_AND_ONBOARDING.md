# Recruitment and onboarding

Phase 13. Plan features: `recruitment` and `onboarding` (Pro and above). Permissions: `recruitment.view`,
`recruitment.manage`, `onboarding.manage` (the HR administrator role has all three; auditors can view).

## Openings

A recruiter (`recruitment.manage` where the position sits: company, branch or department) drafts an opening
with a title, place, designation, optional hiring manager, number of positions and description. Openings
are numbered `JOB-0001`, `JOB-0002`, … per organisation.

Draft → **sent for approval** (approval subject `job_requisition`; owners by default, or the organisation's
policy) → **open** once approved. A rejected, returned or withdrawn request goes back to draft. Open openings
can be put on hold, reopened and closed; an opening closes itself when every position is filled.

| Who                                | Sees                                 | Can                 |
| ---------------------------------- | ------------------------------------ | ------------------- |
| `recruitment.manage` where it sits | The opening and its pipeline         | Everything below    |
| `recruitment.view` where it sits   | The opening and its pipeline         | —                   |
| The opening's hiring manager       | The opening and its pipeline         | —                   |
| An interviewer                     | Only the applications they interview | Give their feedback |
| Anyone else                        | Nothing (404)                        | —                   |

## Candidates and the pipeline

Candidates are added to an open position with name, email, phone, source, notes and an optional résumé
(PDF, Word or text; encrypted at rest like every document, downloads audited). One candidate record per
email in an organisation: someone who applies again is recognised. A candidate is in an opening once.

Stages: Applied → Screening → Interviewing → Offer → Hired, or Rejected / Withdrawn (a reason is required).
Every change is kept in an append-only history with who made it. Hired, rejected and withdrawn applications
are closed for good (the database refuses changes). Rejecting someone withdraws any offer still out.

## Interviews

A recruiter schedules a round with a time, length, place or link and one or more interviewers (any active
members). Interviewers get a notification and an email, see their interviews under Recruitment → My
interviews, and give a 1–5 rating, a recommendation and comments. Feedback is **blind**: an interviewer sees
the others' feedback only after giving their own. Submitted feedback is final in the database.

## Offers

An offer (joining date, designation, optional annual CTC in the company's currency, notes) goes for
approval as `job_offer`, carrying the amount so policies can route bigger offers to more senior approvers.
Approvers can open the offer from their inbox. Once approved, the recruiter records the candidate's answer;
declining closes the application. Offers move forward only: the database refuses rewriting an offer's terms
and reopening a closed one. Nothing is decided automatically.

## Hiring

Hiring a candidate who accepted makes their employee record from the opening (company, branch, department,
employment type, hiring manager as manager) and the offer (designation, joining date), with their email as
personal email and an optional work email. It needs `employees.manage` where they will sit and counts
against the plan's employee limit. The résumé is kept on the record as an HR-only document. The application
closes as hired and points at the employee.

## Onboarding

`onboarding.manage` keeps checklists: tasks for **HR**, the **manager** or the **new joiner**, each due a
number of days from the joining date (negative = before). Starting onboarding (from the hire dialog or the
employee's Onboarding tab) copies a checklist into a plan with real people and dates; a joiner or manager
without a sign-in yet has their tasks given to the HR person. Everyone with tasks is told. People tick off
their own tasks under Onboarding → My tasks; HR can also skip tasks or cancel the plan. The plan completes
when no task is open. Changing a checklist later doesn't change plans already started.

## Not covered yet

- A public careers page and candidates applying themselves; email to candidates (offers are sent outside
  Smart HR for now). Calendar invitations for interviews.
- Deleting a candidate's personal data on request (data retention rules come with the compliance work).
- Offboarding checklists (the same model will be reused).
