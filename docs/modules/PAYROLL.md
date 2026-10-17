# Payroll

Phase 14. Plan features: `payroll` (Premium and Enterprise) and `payroll.statutory_in` for Indian statutory
deductions. Permissions: `payroll.view`, `payroll.manage`, `payroll.configure`, held where the company or
employee is. A **Payroll administrator** system role has all three plus employees and bank details. Rules and
reasoning: [ADR 0011](../decisions/0011-payroll-and-indian-statutory-rules.md).

## Set-up

- **Pay components:** every organisation starts with Basic (PF wages), House rent allowance and Special
  allowance, and can add earnings and deductions. Each says whether it is taxable, counts as PF wages,
  counts towards ESI wages, and is reduced for unpaid days.
- **Statutory settings per company:** PF and ESI on or off, the labour-code wage rule, PF establishment
  ID, ESI employer code and TAN. Statutory deductions apply only to companies in India.
- **Professional tax:** starting tables for Karnataka, Maharashtra, Telangana and West Bengal; organisations
  can replace them. Check them against the state's current notification.
- **On each employee's record (Pay tab):** salary revisions (effective date, annual CTC, monthly amount per
  component; revisions are kept, never changed), PF participation (and voluntary PF on full wages), ESI, and
  the professional-tax state. Bank account, IFSC and UAN come from Identity and bank details.

## A month's payroll

1. **Start** a run for a company and month. Everyone in the company employed that month with a salary is
   calculated at once.
2. **Check and correct** while it is a draft: each payslip's earnings, deductions (PF, ESI, professional tax,
   income tax, one-off lines) and employer contributions; override loss of pay or add one-off lines. The
   run recalculates after every change, and payslips with deductions above pay are flagged and block
   submission.
3. **Send for approval.** It is recalculated and goes to the approvers set for "Payroll run" (owners by
   default). The person who prepared it can't approve it.
4. **Approved:** payslips are final; employees are told and can download their payslip PDF under Payroll →
   My payslips (amounts are never emailed). Download the payroll register, the bank transfer list (full
   account numbers; recent password entry; audited) and the PF ECR file.
5. **Mark as paid** once the bank has paid.

## Files

| File               | What                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Payroll register   | CSV, one row per person with every line, gross, net and employer cost                                |
| Bank transfer list | CSV: name, account, IFSC, bank, amount, reference; people without bank details are listed at the end |
| PF ECR             | EPFO ECR text, one `#~#` line per member with UAN                                                    |

CSV cells that could be read as spreadsheet formulas are neutralised.
