import { z } from 'zod';

/** Pasting a licence: only its size and shape are checked here; the API verifies the signature. */
export const installLicenceSchema = z.object({
  licence: z
    .string()
    .trim()
    .min(1, 'Paste the licence')
    .max(20_000, 'This is too long to be a licence')
    .regex(/^SHRL\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'This doesn’t look like a Smart HR licence'),
});
export type InstallLicenceInput = z.input<typeof installLicenceSchema>;
