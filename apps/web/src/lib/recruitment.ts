import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export type OpeningStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'OPEN' | 'ON_HOLD' | 'CLOSED';
export type Stage = 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';
export type OfferStatus =
  'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'CANCELLED' | 'ACCEPTED' | 'DECLINED';
export type Recommendation = 'STRONG_YES' | 'YES' | 'NO' | 'STRONG_NO';

export interface Opening {
  id: string;
  code: string;
  title: string;
  company: { id: string; name: string };
  branch: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
  employmentType: { id: string; name: string } | null;
  hiringManager: { id: string; name: string } | null;
  positions: number;
  description: string;
  status: OpeningStatus;
  approvalRequestId: string | null;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  applications: number;
  stages: Partial<Record<Stage, number>>;
  hired: number;
  can: { manage: boolean; edit: boolean; submit: boolean; addCandidates: boolean };
}

export interface ApplicationRow {
  id: string;
  stage: Stage;
  closedReason: string | null;
  createdAt: string;
  updatedAt: string;
  interviews: number;
  candidate: { id: string; name: string; email: string; source: string | null };
}

export interface Feedback {
  id: string;
  name: string;
  mine: boolean;
  submitted: boolean;
  submittedAt: string | null;
  rating: number | null;
  recommendation: Recommendation | null;
  comments: string | null;
}

export interface Application {
  id: string;
  stage: Stage;
  closedReason: string | null;
  hiredEmployeeId: string | null;
  createdAt: string;
  opening: { id: string; code: string; title: string; status: OpeningStatus };
  candidate: {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    source: string | null;
    notes: string | null;
    resume: { name: string; size: number } | null;
  };
  events: {
    id: string;
    fromStage: Stage | null;
    toStage: Stage;
    note: string | null;
    by: string | null;
    at: string;
  }[];
  interviews: {
    id: string;
    title: string;
    scheduledAt: string;
    durationMinutes: number;
    location: string | null;
    status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
    feedback: Feedback[];
    canGiveFeedback: boolean;
  }[];
  offers: {
    id: string;
    status: OfferStatus;
    joiningDate: string;
    designationId: string | null;
    annualCtc: number | null;
    currency: string | null;
    notes: string | null;
    approvalRequestId: string | null;
    decisionNote: string | null;
    decidedAt: string | null;
    respondedAt: string | null;
    createdAt: string;
  }[];
  can: { manage: boolean; move: boolean; schedule: boolean; offer: boolean; hire: boolean };
}

export interface MyInterview {
  interviewId: string;
  applicationId: string;
  candidate: string;
  opening: { title: string; code: string };
  title: string;
  scheduledAt: string;
  location: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  feedbackDue: boolean;
}

export interface OnboardingTemplate {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  tasks: {
    id: string;
    position: number;
    title: string;
    description: string | null;
    assignee: 'HR' | 'MANAGER' | 'EMPLOYEE';
    dueOffsetDays: number;
  }[];
}

export interface OnboardingPlan {
  id: string;
  employee: { id: string; name: string; employeeCode: string };
  templateName: string | null;
  startDate: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  completedAt: string | null;
  progress: { done: number; total: number };
  tasks: {
    id: string;
    title: string;
    description: string | null;
    assignee: 'HR' | 'MANAGER' | 'EMPLOYEE';
    assigneeName: string | null;
    dueDate: string;
    status: 'OPEN' | 'DONE' | 'SKIPPED';
    completedAt: string | null;
    completedBy: string | null;
    note: string | null;
    canUpdate: boolean;
  }[];
  can: { manage: boolean; cancel: boolean };
}

export interface MyTask {
  id: string;
  title: string;
  description: string | null;
  assignee: 'HR' | 'MANAGER' | 'EMPLOYEE';
  dueDate: string;
  status: 'OPEN';
  planId: string;
  employee: { id: string; name: string };
  forMe: boolean;
}

export const OPENING_STATUS_LABEL: Record<OpeningStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Waiting for approval',
  OPEN: 'Open',
  ON_HOLD: 'On hold',
  CLOSED: 'Closed',
};
export const OPENING_STATUS_TONE = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'info',
  OPEN: 'success',
  ON_HOLD: 'warning',
  CLOSED: 'neutral',
} as const;

export const STAGE_LABEL: Record<Stage, string> = {
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  INTERVIEW: 'Interviewing',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};
export const STAGE_TONE = {
  APPLIED: 'neutral',
  SCREENING: 'info',
  INTERVIEW: 'info',
  OFFER: 'warning',
  HIRED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
} as const;
export const PIPELINE: Stage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  PENDING_APPROVAL: 'Waiting for approval',
  APPROVED: 'Approved — waiting for the candidate',
  REJECTED: 'Not approved',
  RETURNED: 'Sent back',
  CANCELLED: 'Withdrawn',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  STRONG_YES: 'Strong yes',
  YES: 'Yes',
  NO: 'No',
  STRONG_NO: 'Strong no',
};

export const ASSIGNEE_LABEL = { HR: 'HR', MANAGER: 'Manager', EMPLOYEE: 'New joiner' } as const;

export const recruitmentKeys = {
  all: ['recruitment'] as const,
  openings: (status: string) => ['recruitment', 'openings', status] as const,
  opening: (id: string) => ['recruitment', 'opening', id] as const,
  applications: (openingId: string) => ['recruitment', 'applications', openingId] as const,
  application: (id: string) => ['recruitment', 'application', id] as const,
  interviews: ['recruitment', 'interviews'] as const,
  offer: (id: string) => ['recruitment', 'offer', id] as const,
  onboarding: ['onboarding'] as const,
  templates: ['onboarding', 'templates'] as const,
  plans: (employeeId: string) => ['onboarding', 'plans', employeeId] as const,
  myTasks: ['onboarding', 'mine'] as const,
};

export const useOpenings = (status: string, enabled = true) =>
  useQuery({
    queryKey: recruitmentKeys.openings(status),
    queryFn: () => apiFetch<Opening[]>(`/v1/recruitment/openings?status=${status}`),
    enabled,
  });
export const useOpening = (id: string) =>
  useQuery({
    queryKey: recruitmentKeys.opening(id),
    queryFn: () => apiFetch<Opening>(`/v1/recruitment/openings/${id}`),
  });
export const useApplications = (openingId: string) =>
  useQuery({
    queryKey: recruitmentKeys.applications(openingId),
    queryFn: () => apiFetch<ApplicationRow[]>(`/v1/recruitment/openings/${openingId}/applications`),
  });
export const useApplication = (id: string) =>
  useQuery({
    queryKey: recruitmentKeys.application(id),
    queryFn: () => apiFetch<Application>(`/v1/recruitment/applications/${id}`),
  });
export const useMyInterviews = () =>
  useQuery({
    queryKey: recruitmentKeys.interviews,
    queryFn: () => apiFetch<MyInterview[]>('/v1/recruitment/interviews/mine'),
  });
export const useOnboardingTemplates = (enabled = true) =>
  useQuery({
    queryKey: recruitmentKeys.templates,
    queryFn: () => apiFetch<OnboardingTemplate[]>('/v1/onboarding/templates'),
    enabled,
  });
export const useOnboardingPlans = (employeeId: string) =>
  useQuery({
    queryKey: recruitmentKeys.plans(employeeId),
    queryFn: () =>
      apiFetch<{ can: { start: boolean }; plans: OnboardingPlan[] }>(
        `/v1/onboarding/employees/${employeeId}`,
      ),
  });
export const useMyOnboardingTasks = () =>
  useQuery({
    queryKey: recruitmentKeys.myTasks,
    queryFn: () => apiFetch<MyTask[]>('/v1/onboarding/tasks/mine'),
  });

/** "2 Nov 2026, 10:00". */
export function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function money(amount: number | null, currency: string | null): string {
  if (amount === null) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency ?? 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}
