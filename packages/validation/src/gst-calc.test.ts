import { describe, expect, it } from 'vitest';
import { invoiceKey, parseGstr2b, portalDate, reconcileGstr2b, type BookRow } from './gst-calc.js';

const book = (over: Partial<BookRow> = {}): BookRow => ({
  id: 'b1',
  gstin: '29ABCDE1234F1Z5',
  supplier: 'Acme Packaging',
  number: 'PK-2291',
  date: '2026-10-05',
  taxable: 100000,
  cgst: 9000,
  sgst: 9000,
  igst: 0,
  ...over,
});

const file = (inv: object) => ({
  data: { docdata: { b2b: [{ ctin: '29abcde1234f1z5', trdnm: 'Acme Packaging', inv: [inv] }] } },
});

describe('invoice keys and dates', () => {
  it('ignores case, punctuation and leading zeros', () => {
    expect(invoiceKey('29ABCDE1234F1Z5', 'INV/0012')).toBe(invoiceKey('29abcde1234f1z5', 'inv-12'));
    expect(invoiceKey('X', '10')).not.toBe(invoiceKey('X', '1'));
  });
  it('reads portal dates', () => {
    expect(portalDate('05-10-2026')).toBe('2026-10-05');
    expect(portalDate('2026-10-05')).toBe('2026-10-05');
    expect(portalDate('nonsense')).toBeNull();
  });
});

describe('parseGstr2b', () => {
  it('reads invoices with item detail', () => {
    const rows = parseGstr2b(
      file({
        inum: 'PK-2291',
        dt: '05-10-2026',
        items: [{ num: 1, rt: 18, txval: 100000, cgst: 9000, sgst: 9000 }],
      }),
    );
    expect(rows).toEqual([
      {
        gstin: '29ABCDE1234F1Z5',
        supplier: 'Acme Packaging',
        number: 'PK-2291',
        date: '2026-10-05',
        taxable: 100000,
        cgst: 9000,
        sgst: 9000,
        igst: 0,
      },
    ]);
  });
  it('reads invoice level totals and the older itm_det shape', () => {
    expect(parseGstr2b(file({ inum: 'A1', dt: '01-10-2026', txval: 500, igst: 90 }))[0]).toMatchObject({
      taxable: 500,
      igst: 90,
    });
    const old = parseGstr2b(file({ inum: 'A2', itms: [{ itm_det: { txval: 200, iamt: 36 } }] }));
    expect(old[0]).toMatchObject({ taxable: 200, igst: 36 });
  });
  it('reads a plain list and rejects other files', () => {
    expect(
      parseGstr2b([{ gstin: '29abcde1234f1z5', number: 'X1', date: '2026-10-01', taxable: 10, igst: 1.8 }]),
    ).toHaveLength(1);
    expect(() => parseGstr2b({ hello: 'world' })).toThrow(/GSTR-2B/);
  });
});

describe('reconcileGstr2b', () => {
  it('matches, flags differences, and finds what is missing on either side', () => {
    const portal = parseGstr2b({
      data: {
        docdata: {
          b2b: [
            {
              ctin: '29ABCDE1234F1Z5',
              inv: [
                { inum: 'PK/2291', txval: 100000, cgst: 9000, sgst: 9000 },
                { inum: 'PK-2292', txval: 5000, igst: 900 },
                { inum: 'PK-9999', txval: 1000, igst: 180 },
              ],
            },
          ],
        },
      },
    });
    const rows = reconcileGstr2b(
      [
        book(),
        book({ id: 'b2', number: 'PK-2292', taxable: 5000, cgst: 0, sgst: 0, igst: 450 }),
        book({ id: 'b3', number: 'GONE-1' }),
      ],
      portal,
    );
    const by = (num: string) => rows.find((r) => r.number === num)!;
    expect(by('PK-2291').status).toBe('MATCHED');
    expect(by('PK-2292')).toMatchObject({ status: 'MISMATCH', differences: ['IGST'] });
    expect(by('GONE-1').status).toBe('MISSING_IN_2B');
    expect(by('PK-9999').status).toBe('MISSING_IN_BOOKS');
  });
  it('allows a rupee of rounding', () => {
    const rows = reconcileGstr2b(
      [book({ cgst: 9000.4 })],
      [
        {
          gstin: '29ABCDE1234F1Z5',
          supplier: null,
          number: 'PK-2291',
          date: null,
          taxable: 100000,
          cgst: 9000,
          sgst: 9000,
          igst: 0,
        },
      ],
    );
    expect(rows[0]!.status).toBe('MATCHED');
  });
});
