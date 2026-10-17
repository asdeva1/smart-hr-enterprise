import { describe, expect, it } from 'vitest';
import {
  fillPlaceholders,
  letterTemplateSchema,
  placeholdersIn,
  signatureRequestSchema,
  uploadDocumentSchema,
} from './documents.js';

describe('letter templates', () => {
  it('finds and fills placeholders, leaving unknown ones visible', () => {
    const body = 'Dear {{ employee.firstName }}, welcome to {{organisation.name}} ({{employee.firstName}}).';
    expect(placeholdersIn(body)).toEqual(['employee.firstName', 'organisation.name']);
    expect(fillPlaceholders(body, { 'employee.firstName': 'Asha' })).toBe(
      'Dear Asha, welcome to {{organisation.name}} (Asha).',
    );
  });

  it('refuses unknown placeholders', () => {
    const r = letterTemplateSchema.safeParse({ name: 'Offer', body: 'Pay: {{employee.salary}} {{today}}' });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('{{employee.salary}}');
    expect(letterTemplateSchema.safeParse({ name: 'Offer', body: 'Dated {{today}}, hello.' }).success).toBe(
      true,
    );
  });
});

describe('uploads and signature requests', () => {
  it('reads multipart text fields', () => {
    expect(
      uploadDocumentSchema.parse({
        title: 'ID',
        category: 'IDENTITY',
        visibleToEmployee: 'false',
        expiresOn: '',
      }),
    ).toMatchObject({
      visibleToEmployee: false,
      expiresOn: null,
    });
    expect(uploadDocumentSchema.safeParse({ title: 'ID', category: 'SECRET' }).success).toBe(false);
  });

  it('needs distinct signers', () => {
    const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(signatureRequestSchema.safeParse({ signerMembershipIds: [id, id] }).success).toBe(false);
    expect(signatureRequestSchema.safeParse({ signerMembershipIds: [] }).success).toBe(false);
    expect(signatureRequestSchema.parse({ signerMembershipIds: [id] })).toMatchObject({
      sequential: true,
      expiresInDays: 14,
    });
  });
});
