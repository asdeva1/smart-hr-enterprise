import { z } from 'zod';

export const assistantSchema = z.object({
  message: z.string().trim().min(1, 'Ask something').max(2000, 'Keep it under 2000 characters'),
  /** Earlier turns of this conversation, oldest first. Nothing is stored on the server. */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(10)
    .default([]),
});

export const aiPolicySchema = z.object({ enabled: z.boolean() });
