/**
 * Kinds of request that go through the approval engine. Each module registers a handler for its own
 * subject type when it ships; policies can be configured for any of them ahead of time.
 */
export const APPROVAL_SUBJECTS = {
  leave_request: {
    label: 'Leave request',
    module: 'Leave',
    hasAmount: false,
    managerByDefault: true,
    notifySubject: true,
  },
  attendance_regularization: {
    label: 'Attendance correction',
    module: 'Attendance',
    hasAmount: false,
    managerByDefault: true,
    notifySubject: true,
  },
  employee_change: { label: 'Employment change', module: 'Employees', hasAmount: false },
  expense_claim: { label: 'Expense claim', module: 'Expenses', hasAmount: true },
  travel_request: { label: 'Travel request', module: 'Expenses', hasAmount: true },
  purchase_requisition: { label: 'Purchase request', module: 'Procurement', hasAmount: true },
  purchase_order: { label: 'Purchase order', module: 'Procurement', hasAmount: true },
  vendor_payment: { label: 'Vendor payment', module: 'Finance', hasAmount: true },
  journal_entry: { label: 'Journal entry', module: 'Finance', hasAmount: true },
  job_requisition: { label: 'Job requisition', module: 'Recruitment', hasAmount: false },
  job_offer: { label: 'Job offer', module: 'Recruitment', hasAmount: true },
  payroll_run: { label: 'Payroll run', module: 'Payroll', hasAmount: true },
  workspace_change: { label: 'Operations workspace change', module: 'Operations', hasAmount: false },
} as const satisfies Record<
  string,
  {
    label: string;
    module: string;
    hasAmount: boolean;
    managerByDefault?: boolean;
    /** Tell the employee a request is about when someone else makes it, and when it is decided. */
    notifySubject?: boolean;
  }
>;

export type ApprovalSubjectType = keyof typeof APPROVAL_SUBJECTS;

export function isApprovalSubject(value: string): value is ApprovalSubjectType {
  return Object.prototype.hasOwnProperty.call(APPROVAL_SUBJECTS, value);
}

/**
 * Requests about one employee (leave, attendance corrections) go to their reporting manager until the
 * organisation sets its own policy; everything else goes to the owners. Owners are always the backstop
 * when a rule finds nobody.
 */
export function defaultApproverIsManager(subjectType: string): boolean {
  return isApprovalSubject(subjectType) && 'managerByDefault' in APPROVAL_SUBJECTS[subjectType];
}

/** Whether the employee a request is about hears about it when someone else makes it or decides it. */
export function notifiesSubject(subjectType: string): boolean {
  return isApprovalSubject(subjectType) && 'notifySubject' in APPROVAL_SUBJECTS[subjectType];
}

/** Notification categories and whether email is on unless the person turns it off. */
export const NOTIFICATION_CATEGORIES = {
  'approval.assigned': { label: 'Something is waiting for my approval', emailDefault: true },
  'approval.decided': { label: 'My request was approved, rejected or sent back', emailDefault: true },
  'approval.overdue': { label: 'An approval I own is overdue', emailDefault: true },
  'approval.escalated': { label: 'An approval in my organisation is overdue (owners)', emailDefault: false },
  'request.about_me': {
    label: 'Someone else asked for leave or a correction for me, or it was decided',
    emailDefault: true,
  },
  'subscription.changed': {
    label: 'My organisation’s subscription ended or changed (owners)',
    emailDefault: true,
  },
} as const satisfies Record<string, { label: string; emailDefault: boolean }>;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export function isNotificationCategory(value: string): value is NotificationCategory {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_CATEGORIES, value);
}
