import { z } from 'zod';

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'Enter a domain such as example.com');

/** Saving an organisation's single sign-on settings. The client secret is only sent when it changes. */
export const saveSsoConnectionSchema = z
  .object({
    issuer: z
      .url('Enter the provider’s issuer URL')
      .max(500)
      .transform((v) => v.replace(/\/+$/, '')),
    clientId: z.string().trim().min(1, 'Enter the client ID').max(300),
    clientSecret: z.string().min(1).max(2000).optional(),
    allowedDomains: z.array(domain).min(1, 'Add at least one email domain').max(20),
    requireVerifiedEmail: z.boolean().default(true),
    enabled: z.boolean().default(false),
    enforced: z.boolean().default(false),
  })
  .strict()
  .refine((v) => !v.enforced || v.enabled, {
    path: ['enforced'],
    message: 'Turn single sign-on on before requiring it',
  });
export type SaveSsoConnectionInput = z.output<typeof saveSsoConnectionSchema>;

export const ssoDiscoverQuerySchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export const ssoStartQuerySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  next: z.string().max(300).optional(),
});
