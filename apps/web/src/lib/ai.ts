export interface AiStatus {
  available: boolean;
  enabled: boolean;
  model: string;
  tokensUsed: number;
  tokenLimit: number | null;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const TOOL_LABEL: Record<string, string> = {
  my_leave_balances: 'your leave balances',
  my_open_work: 'your open work',
  my_time_logged: 'your logged time',
};

export const aiKeys = { status: ['ai', 'status'] as const };
