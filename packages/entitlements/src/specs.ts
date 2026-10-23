import type { Feature, LimitKey } from './catalogue.js';

/**
 * What the product does, module by module, written for the people who decide plans. This is the one list the
 * platform console's "Features and specifications" page and the printed specification both read, so they
 * never disagree. Add to it when a module gains a capability.
 *
 * `delivery` says how real each plan feature is today, because a plan must not promise what is not built:
 *  - BUILT:          works, and the plan feature switches it on and off.
 *  - BUILT_UNGATED:  works, but every plan gets it because no code checks the plan feature yet.
 *  - PARTIAL:        part of it works (see `notYet`).
 *  - NOT_BUILT:      listed in the catalogue, nothing behind it yet.
 *  - DEFERRED:       planned for later, outside the current build.
 */
export type Delivery = 'BUILT' | 'BUILT_UNGATED' | 'PARTIAL' | 'NOT_BUILT' | 'DEFERRED';

export const AREAS = [
  'Foundation (every plan)',
  'People and HR',
  'Finance and ERP',
  'Operations',
  'Shared services',
  'Security and integration',
] as const;
export type Area = (typeof AREAS)[number];

export interface ModuleSpec {
  id: string;
  name: string;
  area: Area;
  /** Plan features that switch this module on. Empty means it is part of the foundation and never gated. */
  features: readonly Feature[];
  delivery: Delivery;
  summary: string;
  capabilities: readonly string[];
  /** Numeric limits that apply to it. */
  limits?: readonly LimitKey[];
  /** What is missing or planned. */
  notYet?: readonly string[];
}

export const MODULE_SPECS: readonly ModuleSpec[] = [
  // ---------------------------------------------------------------------------------------------------------
  // Foundation
  {
    id: 'organisation',
    name: 'Organisation structure and master data',
    area: 'Foundation (every plan)',
    features: [],
    delivery: 'BUILT',
    summary: 'Companies, branches, departments and the reference lists every module draws on.',
    capabilities: [
      'Companies (legal entities) with currency, time zone and country',
      'Branches and nested departments',
      'Designations, grades, employment types, cost centres, exit reasons',
      'Holiday calendars by organisation, company or branch',
      'Reference lists the organisation can extend',
      'Organisation settings (a registry of validated settings with defaults)',
    ],
    limits: ['companies.max'],
  },
  {
    id: 'access',
    name: 'People, roles and access',
    area: 'Foundation (every plan)',
    features: [],
    delivery: 'BUILT',
    summary:
      'Who can sign in and what each person can see and do, scoped to a company, branch or department.',
    capabilities: [
      'Invite members by email; suspend and restore access',
      'Nine built-in roles: organisation administrator, access administrator, HR administrator, payroll administrator, accountant, finance team, operations manager, auditor, member',
      'Custom roles built from 48 fine-grained permissions',
      'Role assignments scoped to the whole organisation, a company, a branch or a department',
      'Reporting-line visibility for managers',
    ],
    limits: ['users.max'],
  },
  {
    id: 'approvals',
    name: 'Approvals and notifications',
    area: 'Foundation (every plan)',
    features: [],
    delivery: 'BUILT',
    summary: 'One approval engine and one notification service used by every module.',
    capabilities: [
      'Approval policies per request type: approvers, amount thresholds, multi-step',
      'Delegation while an approver is away; escalation of overdue approvals',
      'Requester cannot approve their own request',
      'In-app notification bell and email notifications with a queue',
      'Approvals inbox for approvers and "my requests" for requesters',
    ],
  },
  {
    id: 'audit',
    name: 'Audit log',
    area: 'Foundation (every plan)',
    features: [],
    delivery: 'BUILT',
    summary: 'An append-only record of sensitive actions that nobody can edit or delete.',
    capabilities: [
      'Who did what, when, from where, and the outcome',
      'Filtered audit screen for auditors and administrators',
      'Sensitive reads (bank details, payroll files) are recorded too',
    ],
  },
  {
    id: 'audit-advanced',
    name: 'Advanced audit',
    area: 'Foundation (every plan)',
    features: ['audit.advanced'],
    delivery: 'NOT_BUILT',
    summary: 'Advanced audit search and exports.',
    capabilities: [],
    notYet: ['Not started. The basic audit log is available to every plan'],
  },
  {
    id: 'org-admin',
    name: 'Organisation administration',
    area: 'Foundation (every plan)',
    features: [],
    delivery: 'BUILT',
    summary: 'Tools an organisation administrator uses to run their own space.',
    capabilities: [
      'Branding: organisation name, logo and brand colour',
      'Plan and usage page showing what the plan includes and what has been used',
      'Your data: full organisation data export for offboarding',
      'Global search across people, projects, work items, assets and stock',
      'Upgrade request sent to the sales inbox',
    ],
  },
  // ---------------------------------------------------------------------------------------------------------
  // People and HR
  {
    id: 'employees',
    name: 'Employee records and directory',
    area: 'People and HR',
    features: ['hr.core'],
    delivery: 'BUILT',
    summary: 'The employee master: one record per person, separate from their sign-in account.',
    capabilities: [
      'Directory with search, status filter and sorting, limited to what the viewer may see',
      'Add and edit employees; automatic or typed employee codes',
      'Job placement: company, branch, department, designation, grade, manager',
      'Org chart from reporting lines',
      'Identity and bank details (PAN, Aadhaar, bank account, IFSC, UAN), masked until revealed and audited',
      'Emergency contacts; employment history with effective dates',
      'CSV import with a dry run that reports every problem before anything changes',
    ],
    limits: ['employees.max'],
  },
  {
    id: 'lifecycle',
    name: 'Employment lifecycle',
    area: 'People and HR',
    features: ['hr.lifecycle'],
    delivery: 'BUILT_UNGATED',
    summary: 'Promotions, transfers, manager changes, notice and exit, each through approval.',
    capabilities: [
      'Promotion, transfer and manager change with effective dates',
      'Give notice, withdraw notice, record exit with reason and last working day',
      'Changes can require approval; the full history is kept',
    ],
    notYet: ['Works for every plan today: the plan feature hr.lifecycle is not checked by any code yet'],
  },
  {
    id: 'attendance',
    name: 'Attendance and shifts',
    area: 'People and HR',
    features: ['attendance.basic'],
    delivery: 'BUILT',
    summary: 'Clock-ins, shifts, daily status and corrections.',
    capabilities: [
      'Clock in and out from the web app; month calendar for each person',
      'Team view and monthly register with present, half-day, absent and late totals',
      'Shifts with assignment from a date; default shift',
      'Attendance corrections through approval',
      'Biometric machines (eSSL and other ZKTeco devices) push scans to the server; scans become attendance automatically',
    ],
  },
  {
    id: 'attendance-advanced',
    name: 'Advanced attendance',
    area: 'People and HR',
    features: ['attendance.advanced'],
    delivery: 'NOT_BUILT',
    summary: 'Rosters, overtime and regularisation rules.',
    capabilities: [],
    notYet: [
      'Rosters',
      'Overtime approval',
      'Regularisation rules beyond corrections',
      'Geofencing and mobile clock-in',
    ],
  },
  {
    id: 'leave',
    name: 'Leave and holidays',
    area: 'People and HR',
    features: ['leave.basic'],
    delivery: 'BUILT',
    summary: 'Leave types, balances, requests and holiday calendars.',
    capabilities: [
      'Leave types: yearly or monthly credit, days per year, half days, notice period, longest request',
      'Carry-forward up to a limit; weekly offs and holidays counted or not (sandwich rule)',
      'Apply with a live day count; approval; withdraw or cancel',
      'Balances per person and type, with every change recorded; HR can adjust and apply on someone’s behalf',
      'Team calendar of who is away; approved leave shows in attendance',
    ],
    notYet: ['Encashment', 'Automatic compensatory off', 'Policies that differ by company, grade or gender'],
  },
  {
    id: 'leave-advanced',
    name: 'Advanced leave',
    area: 'People and HR',
    features: ['leave.advanced'],
    delivery: 'PARTIAL',
    summary: 'Accrual, carry-forward, encashment and partial days.',
    capabilities: [
      'Accrual, carry-forward and half days already work and are included in every plan with leave',
    ],
    notYet: ['Encashment is not built; the plan feature leave.advanced is not checked by any code yet'],
  },
  {
    id: 'self-service',
    name: 'Employee and manager self-service',
    area: 'People and HR',
    features: ['self_service.employee', 'self_service.manager'],
    delivery: 'BUILT',
    summary: 'A personal home page and a team page.',
    capabilities: [
      'Employee home: today’s attendance with clock button, things waiting for approval, leave balances, next holiday, assigned work, hours this week, assets held',
      'Manager "team today": in, on leave, late and not in yet; leave requests waiting',
      'Each section appears only if the plan includes that module and the person can use it',
    ],
  },
  {
    id: 'recruitment',
    name: 'Recruitment',
    area: 'People and HR',
    features: ['recruitment'],
    delivery: 'BUILT',
    summary: 'Openings, candidates, interviews and offers.',
    capabilities: [
      'Job openings with approval; numbered JOB-0001…',
      'Candidate pipeline by stage; resumes stored encrypted',
      'Interview scheduling with interviewer feedback visible only to the right people',
      'Offers with approval; hire a candidate into an employee record',
    ],
    notYet: ['Public careers page', 'Email to candidates from the system', 'Calendar invitations'],
  },
  {
    id: 'onboarding',
    name: 'Onboarding',
    area: 'People and HR',
    features: ['onboarding'],
    delivery: 'BUILT',
    summary: 'Checklists for people joining.',
    capabilities: [
      'Onboarding checklist templates and per-person checklists with owners and due dates',
      'Progress shown to HR and to the new joiner',
    ],
    notYet: ['Offboarding checklists'],
  },
  {
    id: 'payroll',
    name: 'Payroll',
    area: 'People and HR',
    features: ['payroll'],
    delivery: 'BUILT',
    summary: 'Monthly payroll runs, payslips and bank files, with approval.',
    capabilities: [
      'Pay components (earnings and deductions) with taxable, PF-wage and ESI-wage flags',
      'Salary revisions kept as history; annual CTC with monthly breakup',
      'Monthly run for a company: calculate, correct, send for approval, mark paid',
      'Payslips as PDF for employees; amounts are never emailed',
      'Payroll register, bank transfer list and exports with formula-injection protection',
      'Automatic journal postings to the books when finance is on',
    ],
  },
  {
    id: 'statutory',
    name: 'India statutory compliance',
    area: 'People and HR',
    features: ['payroll.statutory_in'],
    delivery: 'BUILT',
    summary: 'PF, ESI, professional tax and TDS on salary.',
    capabilities: [
      'Provident fund and ESI calculation with employer contributions; PF ECR file for EPFO',
      'Professional tax tables for Karnataka, Maharashtra, Telangana and West Bengal (replaceable)',
      'Income tax deduction on salary',
      'Per-company PF establishment ID, ESI code and TAN',
    ],
  },
  {
    id: 'performance',
    name: 'Performance management',
    area: 'People and HR',
    features: ['performance'],
    delivery: 'NOT_BUILT',
    summary: 'Goals, reviews and feedback.',
    capabilities: [],
    notYet: ['Not started'],
  },
  {
    id: 'documents',
    name: 'Documents',
    area: 'People and HR',
    features: ['documents'],
    delivery: 'BUILT',
    summary: 'Employee documents, encrypted at rest.',
    capabilities: [
      'Contracts, ID copies, certificates and letters on each employee record, with expiry dates and reminders',
      'Share with the employee or keep HR-only; employees can add their own',
      'Letter templates that fill in employee details and produce PDFs',
      'Files encrypted before they leave the server and checked against their hash when read',
    ],
    limits: ['storage.gb'],
  },
  {
    id: 'esignature',
    name: 'Electronic signatures',
    area: 'People and HR',
    features: ['esignature'],
    delivery: 'BUILT',
    summary: 'Send a document to be signed and keep the evidence.',
    capabilities: [
      'Signature requests to one or more signers, in order',
      'Signed copy with the evidence page; reminders',
    ],
  },
  // ---------------------------------------------------------------------------------------------------------
  // Finance and ERP
  {
    id: 'books',
    name: 'Books of accounts',
    area: 'Finance and ERP',
    features: ['finance'],
    delivery: 'BUILT',
    summary: 'Double-entry books for each company.',
    capabilities: [
      'Chart of accounts with Indian starting chart; system accounts for receivables, payables, GST and TDS',
      'Journals: draft, approve, post, reverse; posted journals can never be edited',
      'Closing the books by period; reopening needs a permission',
      'Day book, cash book, bank book and general ledger',
      'Trial balance, profit and loss, balance sheet',
      'Automatic postings from payroll, sales and purchases',
    ],
  },
  {
    id: 'sales',
    name: 'Sales and receivables',
    area: 'Finance and ERP',
    features: ['finance'],
    delivery: 'BUILT',
    summary: 'GST invoicing from quotation to payment.',
    capabilities: [
      'Customers with GSTIN and state; automatic CGST and SGST, or IGST for another state',
      'Quotations, proforma invoices, delivery challans, tax invoices and credit notes',
      'Numbering that restarts each financial year (INV/2026-27/0001)',
      'Invoice templates (logo, colours, footer, terms) and a printable invoice with amount in words',
      'Payments received that settle the oldest invoices first; part payments',
      'Receivables ageing and customer statements',
    ],
  },
  {
    id: 'purchases',
    name: 'Purchases and payables',
    area: 'Finance and ERP',
    features: ['finance', 'vendors'],
    delivery: 'BUILT',
    summary: 'Vendor bills, debit notes and payments with input GST and TDS.',
    capabilities: [
      'Vendor bills booked to expense or asset accounts, with input CGST, SGST or IGST',
      'TDS held back at 1, 2, 5, 10 or 20 per cent and posted to a TDS payable account',
      'Debit notes that reverse a posted bill',
      'Payments to vendors that settle the oldest bills first; payables ageing; vendor ledger',
    ],
  },
  {
    id: 'gst',
    name: 'GST and TDS returns',
    area: 'Finance and ERP',
    features: ['finance'],
    delivery: 'BUILT',
    summary: 'Return-ready figures worked out from posted documents.',
    capabilities: [
      'GSTR-1: B2B, B2C large, B2C small, credit notes and HSN summary, with CSV downloads',
      'GSTR-3B style summary: tax on sales less input credit by head',
      'Purchase register',
      'GSTR-2B check: upload the portal file and match it with your bills',
      'TDS deducted by vendor and rate',
    ],
    notYet: ['E-invoice (IRN) and e-way bill need an account with a GST portal provider'],
  },
  {
    id: 'bank',
    name: 'Bank reconciliation',
    area: 'Finance and ERP',
    features: ['finance'],
    delivery: 'NOT_BUILT',
    summary: 'Match bank statements with the books.',
    capabilities: [],
    notYet: ['Next in the build plan: statement import and matching'],
  },
  {
    id: 'expenses',
    name: 'Expenses',
    area: 'Finance and ERP',
    features: ['expenses'],
    delivery: 'BUILT',
    summary: 'Claims and reimbursements.',
    capabilities: [
      'Expense categories with per-expense caps and receipt rules',
      'Claims with several lines; sent for approval; numbered EXP-000001',
      'Approved claims marked paid exactly once',
    ],
  },
  {
    id: 'vendors',
    name: 'Vendors',
    area: 'Finance and ERP',
    features: ['vendors'],
    delivery: 'BUILT',
    summary: 'The supplier master shared by every company.',
    capabilities: ['Code, name, GSTIN, PAN, contact and payment terms', 'Archive, never delete'],
  },
  {
    id: 'procurement',
    name: 'Procurement',
    area: 'Finance and ERP',
    features: ['procurement'],
    delivery: 'BUILT',
    summary: 'From purchase request to goods received.',
    capabilities: [
      'Purchase requests with approval (PR-000001)',
      'Purchase orders to an active vendor, tax per line, with approval (PO-000001)',
      'Goods received in parts against an order (GRN-000001); receipts are never edited',
    ],
  },
  {
    id: 'assets',
    name: 'Assets',
    area: 'Finance and ERP',
    features: ['assets'],
    delivery: 'BUILT',
    summary: 'Register, assignment and depreciation.',
    capabilities: [
      'Asset register with tag, category, serial, supplier, cost and useful life',
      'Give out and take back with condition; one holder at a time',
      'Retire with a reason; straight-line depreciation worked out on read',
    ],
    notYet: ['Posting depreciation to the books', 'Exit checklist that prompts for assets still held'],
  },
  {
    id: 'inventory',
    name: 'Inventory',
    area: 'Finance and ERP',
    features: ['inventory'],
    delivery: 'BUILT',
    summary: 'Items, warehouses and an append-only stock ledger.',
    capabilities: [
      'Items with SKU, unit, reorder level and value',
      'Warehouses per company',
      'Receipts, issues, transfers and count adjustments; stock can never go below zero',
      'Low-stock list',
    ],
    notYet: ['Batches, serial numbers and valuation, linked to invoices and bills (next in the build plan)'],
  },
  {
    id: 'projects',
    name: 'Projects and timesheets',
    area: 'Finance and ERP',
    features: ['projects'],
    delivery: 'BUILT',
    summary: 'Time logging and project profitability.',
    capabilities: [
      'Projects with client, hourly billing rate, hour budget and team',
      'Time logging with a 24-hour daily limit; approval by the project manager',
      'Profitability from billable minutes at the project rate against cost rates',
    ],
  },
  // ---------------------------------------------------------------------------------------------------------
  // Operations
  {
    id: 'operations',
    name: 'Operations workspaces',
    area: 'Operations',
    features: ['operations.templates', 'operations.custom'],
    delivery: 'BUILT',
    summary: 'Track any kind of work through stages, from templates or your own design.',
    capabilities: [
      'Four built-in templates: service requests, quality audits, production batches, support tickets',
      'Custom workspaces: your own stages and questions (text, number, date, choice, yes/no)',
      'Items numbered PREFIX-0001 without gaps; assignment, priority, due date, comments',
      'Complete history of every change; "My work" for assigned items',
    ],
    limits: ['operations.workspaces.max'],
  },
  {
    id: 'productivity',
    name: 'Productivity and analytics',
    area: 'Operations',
    features: ['productivity'],
    delivery: 'DEFERRED',
    summary: 'Productivity, quality and CPH analytics.',
    capabilities: [],
    notYet: ['Coder and RCM productivity will come from SmartCode through a feed API'],
  },
  // ---------------------------------------------------------------------------------------------------------
  // Shared services
  {
    id: 'reports',
    name: 'Reports and dashboards',
    area: 'Shared services',
    features: ['reports.standard', 'reports.advanced'],
    delivery: 'BUILT_UNGATED',
    summary: 'Reports inside each module.',
    capabilities: [
      'Module reports exist today: attendance register, payroll register, finance statements, GST returns, ageing, project profitability',
    ],
    notYet: [
      'Plan features reports.standard and reports.advanced are not checked by any code yet',
      'No cross-module analytics screen',
    ],
  },
  {
    id: 'ai',
    name: 'AI assistant',
    area: 'Shared services',
    features: ['ai.assistant', 'ai.governance'],
    delivery: 'BUILT',
    summary: 'A Claude-powered assistant that works only with what the signed-in person may see.',
    capabilities: [
      'Ask about your own leave balances, open work and logged time; read-only, cannot change anything',
      'Summaries of an operations item’s history',
      'Off until the organisation administrator switches it on; monthly token pool per employee with three-month rollover',
      'Usage report and policy controls (ai.governance); questions and answers are never stored',
    ],
    limits: ['ai.tokens.monthly', 'ai.tokens.per_employee'],
    notYet: ['Needs the Amazon Bedrock connection (region, model and key) before it answers'],
  },
  // ---------------------------------------------------------------------------------------------------------
  // Security and integration
  {
    id: 'security',
    name: 'Sign-in security',
    area: 'Security and integration',
    features: [],
    delivery: 'BUILT',
    summary: 'Protection for every account, on every plan.',
    capabilities: [
      'Server-side sessions; password policy; rate limits on sign-in and reset',
      'Two-step verification with an authenticator app and recovery codes; organisation can require it',
      'Recent password entry for sensitive actions',
      'Row-level security so one organisation can never read another’s rows, enforced in the database',
    ],
  },
  {
    id: 'sso',
    name: 'Single sign-on',
    area: 'Security and integration',
    features: ['sso'],
    delivery: 'NOT_BUILT',
    summary: 'OIDC and SAML sign-in.',
    capabilities: [],
    notYet: ['Not started'],
  },
  {
    id: 'integrations',
    name: 'API keys and webhooks',
    area: 'Security and integration',
    features: ['integrations.custom'],
    delivery: 'BUILT',
    summary: 'For an organisation’s own systems.',
    capabilities: [
      'Webhooks for employee, leave and other events, signed, with delivery log and retries',
      'API keys with scopes for pushing data in',
    ],
  },
];

/** What each SaaS-wide control is, for the plan builder. */
export const DELIVERY_LABEL: Record<Delivery, string> = {
  BUILT: 'Built and gated',
  BUILT_UNGATED: 'Built, not gated',
  PARTIAL: 'Partly built',
  NOT_BUILT: 'Not built',
  DEFERRED: 'Deferred',
};
