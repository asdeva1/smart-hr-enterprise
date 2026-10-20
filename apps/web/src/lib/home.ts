export interface Home {
  employee: { id: string; name: string; employeeCode: string } | null;
  date: string;
  attendance: {
    status: string | null;
    firstIn: string | null;
    openSince: string | null;
    nextAction: 'IN' | 'OUT';
    canPunch: boolean;
    holiday: string | null;
    onLeave: string | null;
  } | null;
  leave: { balances: { type: string; available: number }[]; pending: number } | null;
  waitingForMe: {
    count: number;
    overdue: number;
    first: { id: string; title: string; stage: string }[];
  } | null;
  work: {
    open: number;
    overdue: number;
    items: {
      id: string;
      ref: string;
      title: string;
      stage: string;
      dueDate: string | null;
      overdue: boolean;
    }[];
  } | null;
  time: { weekHours: number } | null;
  assets: { count: number } | null;
  holidays: { date: string; name: string }[];
}

export interface TeamToday {
  date: string;
  counts: {
    total: number;
    present: number;
    halfDay: number;
    absent: number;
    late: number;
    notIn: number;
    weeklyOff: number;
    holiday: number;
    onLeave: number;
  } | null;
  notIn: { id: string; name: string; status: string | null }[];
  onLeave: { id: string; name: string }[];
  pendingLeave: number;
}

export const homeKeys = { home: ['me', 'home'] as const, team: ['me', 'team'] as const };
