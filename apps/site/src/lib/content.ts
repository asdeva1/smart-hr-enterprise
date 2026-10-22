/** What the product covers. Mirrors the feature catalogue, so the site never promises more than exists. */
export const areas = [
  {
    name: 'People',
    lead: 'One record per employee, from offer letter to exit.',
    points: [
      'Employee records, directory and employment history',
      'Transfers, promotions and exits with approvals',
      'Documents stored per employee, with e-signature on higher plans',
      'Recruitment, offers and onboarding checklists',
    ],
  },
  {
    name: 'Time',
    lead: 'Attendance and leave that feed payroll without a spreadsheet in between.',
    points: [
      'Shifts, rosters, overtime and regularisation rules',
      'Leave types, accrual, carry-forward and encashment',
      'Employee and manager self-service on any phone',
      'Holiday calendars per location',
    ],
  },
  {
    name: 'Payroll',
    lead: 'Salaries calculated from the attendance you already approved.',
    points: [
      'Payroll runs, payslips and full-and-final settlements',
      'PF, ESI, Professional Tax and TDS for India',
      'Expense claims and reimbursements in the same run',
      'Review and approve before anything is released',
    ],
  },
  {
    name: 'Operations',
    lead: 'For teams that run on volumes, quality and targets, not just headcount.',
    points: [
      'Operations workspaces from ready templates, or your own',
      'Productivity, quality and cost-per-hour analytics',
      'Projects, timesheets and profitability',
      'Assets, inventory and procurement with purchase orders',
    ],
  },
  {
    name: 'Finance',
    lead: 'The ledger behind the payroll, kept in the same place.',
    points: [
      'General ledger, receivables, payables and banking',
      'Vendor master and vendor bills',
      'Standard dashboards and advanced exports',
      'Audit trail you can search and export',
    ],
  },
] as const;

export const security = [
  [
    'Each organisation is walled off',
    'Every query runs inside your organisation. The database itself refuses to return another customer’s rows, even if the application had a bug.',
  ],
  [
    'Changes need a second proof',
    'Roles, members, security settings and branding can only be changed after you confirm with your password and a one-time code sent to your email, or your authenticator app.',
  ],
  [
    'Two-factor sign-in',
    'Authenticator-app codes and recovery codes, and an organisation-wide switch to require them for everyone.',
  ],
  [
    'Sensitive fields are encrypted',
    'Bank details and identity numbers are encrypted before they are stored, with keys that can be rotated.',
  ],
  [
    'Every action leaves a record',
    'Who changed what, and when, is kept in an audit trail that administrators can search.',
  ],
  [
    'Documents stay private',
    'Files are stored in a private bucket and served through short-lived links, never public addresses.',
  ],
] as const;
