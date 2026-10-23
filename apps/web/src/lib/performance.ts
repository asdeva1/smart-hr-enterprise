export type CycleStatus = 'DRAFT' | 'OPEN' | 'CLOSED';
export type GoalStatus = 'ACTIVE' | 'ACHIEVED' | 'DROPPED';
export type AppraisalStatus = 'AWAITING_SELF' | 'AWAITING_MANAGER' | 'COMPLETED' | 'ACKNOWLEDGED';

export interface Cycle {
  id: string;
  companyId: string;
  name: string;
  periodFrom: string;
  periodTo: string;
  status: CycleStatus;
  openedAt: string | null;
  closedAt: string | null;
  people: number;
  completed: number;
}

export interface Goal {
  id: string;
  cycleId: string;
  employeeId: string;
  title: string;
  description: string | null;
  weight: number;
  progress: number;
  status: GoalStatus;
}

export interface PersonRef {
  id: string;
  code: string;
  name: string;
}

export interface Appraisal {
  id: string;
  cycle: { id: string; name: string; status: CycleStatus; companyId: string };
  employee: PersonRef | null;
  reviewer: PersonRef | null;
  status: AppraisalStatus;
  selfRating: number | null;
  selfComment: string | null;
  managerRating: number | null;
  managerComment: string | null;
  completedAt: string | null;
  acknowledgedAt: string | null;
  goals: Goal[];
  goalProgress: number;
}

export interface MyCycle {
  cycle: Cycle;
  goals: Goal[];
  goalProgress: number;
  appraisal: Appraisal | null;
}

export interface FeedbackNote {
  id: string;
  kind: 'PRAISE' | 'SUGGESTION';
  message: string;
  createdAt: string;
  from: PersonRef | null;
  to: PersonRef | null;
}

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  DRAFT: 'Not started',
  OPEN: 'Open',
  CLOSED: 'Closed',
};

export const APPRAISAL_STATUS_LABEL: Record<AppraisalStatus, string> = {
  AWAITING_SELF: 'Waiting for their own review',
  AWAITING_MANAGER: 'Waiting for the manager',
  COMPLETED: 'Reviewed',
  ACKNOWLEDGED: 'Acknowledged',
};

export const RATING_LABEL: Record<number, string> = {
  1: '1 · Needs improvement',
  2: '2 · Below expectations',
  3: '3 · Meets expectations',
  4: '4 · Exceeds expectations',
  5: '5 · Outstanding',
};

export const performanceKeys = {
  all: ['performance'] as const,
  mine: ['performance', 'mine'] as const,
  toReview: ['performance', 'to-review'] as const,
  feedback: ['performance', 'feedback'] as const,
  cycles: ['performance', 'cycles'] as const,
  appraisals: (cycleId: string) => ['performance', 'appraisals', cycleId] as const,
};
