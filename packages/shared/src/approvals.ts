/**
 * Kinds of request that go through the approval engine. Each module registers a handler for its own
 * subject type when it ships; policies can be configured for any of them ahead of time.
 */
export const APPROVAL_SUBJECTS = {
  leave_request: { label: 'Leave request', module: 'Leave', hasAmount: false },
  attendance_regularization: { label: 'Attendance correction', module: 'Attendance', hasAmount: false },
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
} as const satisfies Record<string, { label: string; module: string; hasAmount: boolean }>;

export type ApprovalSubjectType = keyof typeof APPROVAL_SUBJECTS;

export function isApprovalSubject(value: string): value is ApprovalSubjectType {
  return Object.prototype.hasOwnProperty.call(APPROVAL_SUBJECTS, value);
}

/** Notification categories and whether email is on unless the person turns it off. */
export const NOTIFICATION_CATEGORIES = {
  'approval.assigned': { label: 'Something is waiting for my approval', emailDefault: true },
  'approval.decided': { label: 'My request was approved, rejected or sent back', emailDefault: true },
  'approval.overdue': { label: 'An approval I own is overdue', emailDefault: true },
  'approval.escalated': { label: 'An approval in my organisation is overdue (owners)', emailDefault: false },
} as const satisfies Record<string, { label: string; emailDefault: boolean }>;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

export function isNotificationCategory(value: string): value is NotificationCategory {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_CATEGORIES, value);
}
