import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { appendCertificate, isEditablePdf, renderLetterPdf } from './pdf.js';

describe('letters and certificates', () => {
  it('renders a multi-page letter, writing unsupported characters safely', async () => {
    const body = `Dear Priya,\n\nYour salary is ₹ 12,00,000 — नमस्ते.\n\n${'A long paragraph of text. '.repeat(400)}`;
    const pdf = await renderLetterPdf({ organisation: 'Acme', title: 'Offer letter', body, footer: 'x' });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe('Offer letter');
    expect(await isEditablePdf(pdf)).toBe(true);
  });

  it('appends a certificate page and leaves the original pages', async () => {
    const original = await renderLetterPdf({ organisation: 'Acme', title: 'T', body: 'Short.', footer: '' });
    const signed = await appendCertificate(original, {
      requestId: 'r1',
      title: 'T',
      organisation: 'Acme',
      documentSha256: 'ab'.repeat(32),
      requestedBy: 'HR',
      sentAt: new Date('2026-10-01T10:00:00Z'),
      completedAt: new Date('2026-10-02T10:00:00Z'),
      signers: [
        {
          name: 'Priya',
          email: 'p@x.test',
          signedName: 'Priya S',
          signedAt: new Date(),
          ipAddress: '10.0.0.1',
        },
      ],
    });
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(2);
  });

  it('says when something is not a usable PDF', async () => {
    expect(await isEditablePdf(new TextEncoder().encode('%PDF-1.7 broken'))).toBe(false);
  });
});
