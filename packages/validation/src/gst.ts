import { z } from 'zod';
import { dateOnly } from './employees.js';

export const gstPeriodQuerySchema = z
  .object({ companyId: z.uuid(), from: dateOnly, to: dateOnly })
  .refine((v) => v.from <= v.to, { message: 'The start date is after the end date', path: ['to'] });

export const gstr2bReconcileSchema = z.object({
  companyId: z.uuid(),
  from: dateOnly,
  to: dateOnly,
  /** The GSTR-2B file downloaded from the GST portal (JSON), or a plain list of invoices. */
  data: z.unknown(),
});
