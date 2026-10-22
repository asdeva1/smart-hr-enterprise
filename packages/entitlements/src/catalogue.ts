/**
 * Feature and limit keys. Codes are stable identifiers stored in plan versions, add-ons, overrides and
 * licences; labels are for people. The API refuses unknown codes, so add a key here before using it.
 *
 * Organisation structure, people and access, settings, approvals and the audit log are the platform
 * foundation and are never gated — an organisation must always be able to administer itself and reach its
 * data, whatever its plan.
 */
export const FEATURES = {
  // HR
  'hr.core': { module: 'HR', label: 'Employee records and directory' },
  'hr.lifecycle': { module: 'HR', label: 'Transfers, promotions, exits and employment history' },
  'attendance.basic': { module: 'Attendance', label: 'Attendance, shifts and holidays' },
  'attendance.advanced': { module: 'Attendance', label: 'Rosters, overtime and regularisation rules' },
  'leave.basic': { module: 'Leave', label: 'Leave types, balances and requests' },
  'leave.advanced': { module: 'Leave', label: 'Accrual, carry-forward, encashment and partial days' },
  'self_service.employee': { module: 'Self-service', label: 'Employee self-service' },
  'self_service.manager': { module: 'Self-service', label: 'Manager self-service' },
  recruitment: { module: 'Recruitment', label: 'Requisitions, candidates, interviews and offers' },
  onboarding: { module: 'Recruitment', label: 'Pre-boarding and onboarding checklists' },
  payroll: { module: 'Payroll', label: 'Payroll runs, payslips and settlements' },
  'payroll.statutory_in': { module: 'Payroll', label: 'India statutory compliance (PF, ESI, PT, TDS)' },
  performance: { module: 'Performance', label: 'Goals, reviews and feedback' },
  // Finance and ERP
  finance: { module: 'Finance', label: 'General ledger, receivables, payables and banking' },
  expenses: { module: 'Expenses', label: 'Expense claims and reimbursements' },
  vendors: { module: 'Procurement', label: 'Vendor master and vendor bills' },
  procurement: { module: 'Procurement', label: 'Purchase requests and purchase orders' },
  assets: { module: 'Assets', label: 'Asset register, assignment and lifecycle' },
  inventory: { module: 'Inventory', label: 'Items, warehouses and stock' },
  projects: { module: 'Projects', label: 'Projects, timesheets and profitability' },
  // Operations
  'operations.templates': { module: 'Operations', label: 'Operations workspaces from templates' },
  'operations.custom': { module: 'Operations', label: 'Custom operations workspaces' },
  productivity: { module: 'Operations', label: 'Productivity, quality and CPH analytics' },
  // Shared services
  documents: { module: 'Documents', label: 'Document storage' },
  esignature: { module: 'Documents', label: 'Electronic signatures' },
  'reports.standard': { module: 'Reports', label: 'Standard dashboards and reports' },
  'reports.advanced': { module: 'Reports', label: 'Advanced analytics and exports' },
  'audit.advanced': { module: 'Audit', label: 'Advanced audit search and exports' },
  'ai.assistant': { module: 'AI', label: 'AI assistant and summaries' },
  'ai.governance': { module: 'AI', label: 'AI governance and policy controls' },
  sso: { module: 'Security', label: 'Single sign-on (OIDC / SAML)' },
  'integrations.custom': { module: 'Integrations', label: 'API keys, webhooks and custom integrations' },
} as const satisfies Record<string, { module: string; label: string }>;

export type Feature = keyof typeof FEATURES;
export const ALL_FEATURES = Object.keys(FEATURES) as Feature[];

export function isFeature(code: string): code is Feature {
  return Object.prototype.hasOwnProperty.call(FEATURES, code);
}

/** Numeric limits. A missing limit, or null, means unlimited. */
export const LIMITS = {
  'users.max': { label: 'Members (sign-in accounts)', unit: 'members' },
  'employees.max': { label: 'Active employees', unit: 'employees' },
  'storage.gb': { label: 'Document storage', unit: 'GB' },
  'ai.tokens.monthly': { label: 'AI tokens per month', unit: 'tokens' },
  'operations.workspaces.max': { label: 'Operations workspaces', unit: 'workspaces' },
  'companies.max': { label: 'Companies (legal entities)', unit: 'companies' },
} as const satisfies Record<string, { label: string; unit: string }>;

export type LimitKey = keyof typeof LIMITS;
export const ALL_LIMITS = Object.keys(LIMITS) as LimitKey[];

export function isLimitKey(code: string): code is LimitKey {
  return Object.prototype.hasOwnProperty.call(LIMITS, code);
}

/** null = unlimited. */
export type Limits = Partial<Record<LimitKey, number | null>>;

export const DEPLOYMENT_MODELS = ['SAAS', 'DEDICATED', 'IN_HOUSE'] as const;
export type DeploymentModel = (typeof DEPLOYMENT_MODELS)[number];

export const SUPPORT_LEVELS = ['STANDARD', 'PRIORITY', 'PREMIUM', 'DEDICATED'] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];

export interface PlanTemplate {
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  features: Feature[];
  limits: Limits;
  trialDays: number;
  graceDays: number;
  supportLevel: SupportLevel;
  deploymentModels: DeploymentModel[];
}

const LITE: Feature[] = [
  'hr.core',
  'attendance.basic',
  'leave.basic',
  'reports.standard',
  'documents',
  'ai.assistant',
];
const PRO: Feature[] = [
  ...LITE,
  'hr.lifecycle',
  'attendance.advanced',
  'leave.advanced',
  'self_service.employee',
  'self_service.manager',
  'recruitment',
  'onboarding',
  'expenses',
  'assets',
  'operations.templates',
  'reports.advanced',
];
const PREMIUM: Feature[] = [
  ...PRO,
  'payroll',
  'payroll.statutory_in',
  'performance',
  'finance',
  'vendors',
  'procurement',
  'inventory',
  'projects',
  'productivity',
  'esignature',
];

/**
 * The starting catalogue: the four plans from the product brief, with no prices. Platform operators set
 * prices, change quotas and publish new versions; these templates are only used to create version 1 of a
 * plan that does not exist yet, and never overwrite what operators have changed.
 */
export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    // The website's free demo: a small, time-limited sample of the product. Not sold, and hidden from the
    // public plans list. It must stay a subset of Lite.
    code: 'DEMO',
    name: 'Demo',
    description: 'A 14-day look at core HR, attendance and leave with a limited team size.',
    sortOrder: 5,
    features: ['hr.core', 'attendance.basic', 'leave.basic', 'reports.standard'],
    limits: {
      'users.max': 5,
      'employees.max': 25,
      'storage.gb': 1,
      'ai.tokens.monthly': 0,
      'operations.workspaces.max': 0,
      'companies.max': 1,
    },
    trialDays: 14,
    graceDays: 0,
    supportLevel: 'STANDARD',
    deploymentModels: ['SAAS'],
  },
  {
    code: 'LITE',
    name: 'Lite',
    description: 'Core HR, directory, attendance and leave for small teams.',
    sortOrder: 10,
    features: LITE,
    limits: {
      'users.max': 25,
      'employees.max': 50,
      'storage.gb': 10,
      'ai.tokens.monthly': 200_000,
      'operations.workspaces.max': 0,
      'companies.max': 1,
    },
    trialDays: 14,
    graceDays: 14,
    supportLevel: 'STANDARD',
    deploymentModels: ['SAAS'],
  },
  {
    code: 'PRO',
    name: 'Pro',
    description: 'Self-service, recruitment, onboarding, expenses and operations templates.',
    sortOrder: 20,
    features: PRO,
    limits: {
      'users.max': 300,
      'employees.max': 300,
      'storage.gb': 100,
      'ai.tokens.monthly': 2_000_000,
      'operations.workspaces.max': 3,
      'companies.max': 3,
    },
    trialDays: 14,
    graceDays: 14,
    supportLevel: 'STANDARD',
    deploymentModels: ['SAAS'],
  },
  {
    code: 'PREMIUM',
    name: 'Premium',
    description: 'Payroll, finance, procurement, inventory, productivity and higher AI allowance.',
    sortOrder: 30,
    features: PREMIUM,
    limits: {
      'users.max': 2_000,
      'employees.max': 2_000,
      'storage.gb': 500,
      'ai.tokens.monthly': 10_000_000,
      'operations.workspaces.max': 10,
      'companies.max': 10,
    },
    trialDays: 30,
    graceDays: 30,
    supportLevel: 'PRIORITY',
    deploymentModels: ['SAAS'],
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description:
      'The full platform with custom workspaces, SSO, AI governance and dedicated deployment options.',
    sortOrder: 40,
    features: [...ALL_FEATURES],
    limits: {
      'users.max': null,
      'employees.max': null,
      'storage.gb': null,
      'ai.tokens.monthly': null,
      'operations.workspaces.max': null,
      'companies.max': null,
    },
    trialDays: 0,
    graceDays: 30,
    supportLevel: 'PREMIUM',
    deploymentModels: ['SAAS', 'DEDICATED', 'IN_HOUSE'],
  },
];
