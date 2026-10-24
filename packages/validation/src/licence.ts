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

/** Recording a licence that was issued to a customer, optionally as the renewal of an earlier one. */
export const recordIssuedLicenceSchema = z.object({
  licence: installLicenceSchema.shape.licence,
  notes: z.string().trim().max(1000).optional(),
  renews: z.uuid().optional(),
});
export type RecordIssuedLicenceInput = z.input<typeof recordIssuedLicenceSchema>;

export const revokeIssuedLicenceSchema = z.object({
  reason: z.string().trim().min(3, 'Say why it is being revoked').max(300),
});
export type RevokeIssuedLicenceInput = z.input<typeof revokeIssuedLicenceSchema>;

export const issuedLicenceNotesSchema = z.object({ notes: z.string().trim().max(1000) });
export type IssuedLicenceNotesInput = z.input<typeof issuedLicenceNotesSchema>;
