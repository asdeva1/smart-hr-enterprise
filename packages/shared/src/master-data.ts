/**
 * Reference lists each organisation maintains. The lists are code (so modules can rely on them);
 * their values are data. Suggestions are offered once, never inserted without the administrator asking.
 */
export const MASTER_DATA_LISTS = {
  employment_type: {
    label: 'Employment types',
    description: 'How people are engaged, e.g. full-time or contract.',
    usedBy: 'Employees',
    suggestions: [
      { code: 'FT', name: 'Full-time' },
      { code: 'PT', name: 'Part-time' },
      { code: 'CONTRACT', name: 'Contract' },
      { code: 'INTERN', name: 'Intern' },
      { code: 'CONSULTANT', name: 'Consultant' },
    ],
  },
  designation: {
    label: 'Designations',
    description: 'Job titles, e.g. Software Engineer or HR Manager.',
    usedBy: 'Employees, recruitment',
    suggestions: [],
  },
  grade: {
    label: 'Grades and bands',
    description: 'Levels in the job structure, used for policies and pay ranges.',
    usedBy: 'Employees, payroll, expenses',
    suggestions: [],
  },
  cost_centre: {
    label: 'Cost centres',
    description: 'Where costs are booked, independent of reporting lines.',
    usedBy: 'Employees, finance, expenses',
    suggestions: [],
  },
  exit_reason: {
    label: 'Exit reasons',
    description: 'Why people leave, for offboarding and attrition reports.',
    usedBy: 'Offboarding, reports',
    suggestions: [
      { code: 'RESIGNATION', name: 'Resignation' },
      { code: 'TERMINATION', name: 'Termination' },
      { code: 'RETIREMENT', name: 'Retirement' },
      { code: 'CONTRACT_END', name: 'End of contract' },
      { code: 'ABSCONDING', name: 'Absconding' },
    ],
  },
  document_category: {
    label: 'Document categories',
    description: 'How employee and company documents are filed.',
    usedBy: 'Documents',
    suggestions: [
      { code: 'IDENTITY', name: 'Identity proof' },
      { code: 'ADDRESS', name: 'Address proof' },
      { code: 'EDUCATION', name: 'Education' },
      { code: 'EMPLOYMENT', name: 'Previous employment' },
      { code: 'CONTRACT', name: 'Contracts and letters' },
    ],
  },
} as const satisfies Record<
  string,
  {
    label: string;
    description: string;
    usedBy: string;
    suggestions: readonly { code: string; name: string }[];
  }
>;

export type MasterDataList = keyof typeof MASTER_DATA_LISTS;

export function isMasterDataList(value: string): value is MasterDataList {
  return Object.prototype.hasOwnProperty.call(MASTER_DATA_LISTS, value);
}
