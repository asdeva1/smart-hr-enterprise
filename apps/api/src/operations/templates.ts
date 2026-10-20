import type { z } from 'zod';
import type { definitionSchema } from '@smart-hr/validation';

export interface OperationsTemplate {
  key: string;
  name: string;
  description: string;
  prefix: string;
  definition: z.output<typeof definitionSchema>;
}

const basic = (mid: { key: string; label: string }[]): z.output<typeof definitionSchema>['stages'] => [
  { key: 'new', label: 'New', kind: 'OPEN' },
  ...mid.map((m) => ({ ...m, kind: 'OPEN' as const })),
  { key: 'done', label: 'Done', kind: 'DONE' },
  { key: 'cancelled', label: 'Cancelled', kind: 'CANCELLED' },
];

/** Ready-made workspaces. Organisations can start from one and, on a plan that allows it, change it. */
export const OPERATIONS_TEMPLATES: OperationsTemplate[] = [
  {
    key: 'service_requests',
    name: 'Service requests',
    description: 'Requests from staff or customers that someone has to pick up and finish.',
    prefix: 'SR',
    definition: {
      stages: basic([
        { key: 'in_progress', label: 'In progress' },
        { key: 'waiting', label: 'Waiting on requester' },
      ]),
      fields: [
        {
          key: 'category',
          label: 'Category',
          type: 'SELECT',
          required: true,
          options: ['General', 'Access', 'Facilities', 'Finance', 'Other'],
        },
        { key: 'location', label: 'Location', type: 'TEXT', required: false },
      ],
    },
  },
  {
    key: 'quality_audits',
    name: 'Quality audits',
    description: 'Checks of a process or a batch, with a score and findings to follow up.',
    prefix: 'QA',
    definition: {
      stages: basic([
        { key: 'scheduled', label: 'Scheduled' },
        { key: 'review', label: 'In review' },
      ]),
      fields: [
        { key: 'area', label: 'Area audited', type: 'TEXT', required: true },
        { key: 'score', label: 'Score (0–100)', type: 'NUMBER', required: false },
        { key: 'passed', label: 'Passed', type: 'BOOLEAN', required: false },
        { key: 'follow_up_on', label: 'Follow up on', type: 'DATE', required: false },
      ],
    },
  },
  {
    key: 'production_batches',
    name: 'Production batches',
    description: 'Batches of work through preparation, production and checking.',
    prefix: 'PB',
    definition: {
      stages: basic([
        { key: 'preparing', label: 'Preparing' },
        { key: 'producing', label: 'In production' },
        { key: 'checking', label: 'Checking' },
      ]),
      fields: [
        { key: 'product', label: 'Product', type: 'TEXT', required: true },
        { key: 'planned_units', label: 'Planned units', type: 'NUMBER', required: true },
        { key: 'good_units', label: 'Good units', type: 'NUMBER', required: false },
        { key: 'rework_units', label: 'Units to rework', type: 'NUMBER', required: false },
      ],
    },
  },
  {
    key: 'support_tickets',
    name: 'Support tickets',
    description: 'Customer issues from first contact to resolution.',
    prefix: 'TK',
    definition: {
      stages: basic([
        { key: 'investigating', label: 'Investigating' },
        { key: 'waiting', label: 'Waiting on customer' },
      ]),
      fields: [
        { key: 'customer', label: 'Customer', type: 'TEXT', required: true },
        {
          key: 'channel',
          label: 'Channel',
          type: 'SELECT',
          required: false,
          options: ['Email', 'Phone', 'Chat', 'Walk-in'],
        },
      ],
    },
  },
];

export const DEFAULT_DEFINITION: z.output<typeof definitionSchema> = {
  stages: [
    { key: 'todo', label: 'To do', kind: 'OPEN' },
    { key: 'doing', label: 'In progress', kind: 'OPEN' },
    { key: 'done', label: 'Done', kind: 'DONE' },
  ],
  fields: [],
};
