/**
 * GSTR-2B reading and reconciliation. Pure functions: the API and the tests share them.
 * Amounts are rupees; matching tolerates a rupee of rounding difference per figure.
 */

export interface Gstr2bRow {
  gstin: string;
  supplier: string | null;
  number: string;
  date: string | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface BookRow {
  id: string;
  gstin: string;
  supplier: string;
  number: string;
  date: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export type ReconStatus = 'MATCHED' | 'MISMATCH' | 'MISSING_IN_BOOKS' | 'MISSING_IN_2B';

export interface ReconRow {
  status: ReconStatus;
  gstin: string;
  supplier: string | null;
  number: string;
  date: string | null;
  books: { id: string; taxable: number; cgst: number; sgst: number; igst: number } | null;
  portal: { taxable: number; cgst: number; sgst: number; igst: number } | null;
  /** What differs, for a mismatch: "taxable value", "IGST" and so on. */
  differences: string[];
}

const TOLERANCE = 1;
const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** An invoice number compared without punctuation, case or leading zeros: "INV/0012" equals "inv-12". */
export function invoiceKey(gstin: string, number: string): string {
  const clean = number.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Drop zeros only where they follow letters or start the number, so 10 and 1 stay different.
  const key = clean.replace(/(^|[A-Z])0+(?=\d)/g, '$1');
  return `${gstin.trim().toUpperCase()}|${key}`;
}

/** GST portal dates are dd-mm-yyyy; returns yyyy-mm-dd, or null when it can't be read. */
export function portalDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(v.trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
}

function sumItems(inv: Record<string, unknown>) {
  let taxable = n(inv.txval);
  let cgst = n(inv.cgst);
  let sgst = n(inv.sgst);
  let igst = n(inv.igst);
  const items = (Array.isArray(inv.items) ? inv.items : Array.isArray(inv.itms) ? inv.itms : []) as unknown[];
  if (items.length) {
    taxable = cgst = sgst = igst = 0;
    for (const raw of items) {
      const it = obj(raw);
      if (!it) continue;
      const det = obj(it.itm_det) ?? it;
      taxable += n(det.txval);
      cgst += n(det.camt ?? det.cgst);
      sgst += n(det.samt ?? det.sgst);
      igst += n(det.iamt ?? det.igst);
    }
  }
  return { taxable: r2(taxable), cgst: r2(cgst), sgst: r2(sgst), igst: r2(igst) };
}

/**
 * Reads a GSTR-2B JSON file (`data.docdata.b2b`, older files `data.b2b`) or a plain list of
 * `{ gstin, number, date, taxable, cgst, sgst, igst }`. Throws a readable message if it is neither.
 */
export function parseGstr2b(input: unknown): Gstr2bRow[] {
  if (Array.isArray(input)) {
    return input.flatMap((raw) => {
      const r = obj(raw);
      if (!r || !r.gstin || !r.number) return [];
      return [
        {
          gstin: String(r.gstin).trim().toUpperCase(),
          supplier: r.supplier ? String(r.supplier) : null,
          number: String(r.number),
          date: portalDate(r.date),
          taxable: r2(n(r.taxable)),
          cgst: r2(n(r.cgst)),
          sgst: r2(n(r.sgst)),
          igst: r2(n(r.igst)),
        },
      ];
    });
  }
  const root = obj(input);
  const data = obj(root?.data) ?? root;
  const b2b = obj(data?.docdata)?.b2b ?? data?.b2b;
  if (!Array.isArray(b2b)) {
    throw new Error('This does not look like a GSTR-2B file: the b2b section is missing');
  }
  const out: Gstr2bRow[] = [];
  for (const raw of b2b) {
    const s = obj(raw);
    if (!s || !s.ctin) continue;
    const invoices = (Array.isArray(s.inv) ? s.inv : []) as unknown[];
    for (const iv of invoices) {
      const inv = obj(iv);
      if (!inv || !inv.inum) continue;
      out.push({
        gstin: String(s.ctin).trim().toUpperCase(),
        supplier: s.trdnm ? String(s.trdnm) : null,
        number: String(inv.inum),
        date: portalDate(inv.dt),
        ...sumItems(inv),
      });
    }
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

/** Match purchase bills in the books against GSTR-2B invoices on supplier GSTIN and invoice number. */
export function reconcileGstr2b(books: BookRow[], portal: Gstr2bRow[]): ReconRow[] {
  const portalByKey = new Map<string, Gstr2bRow>();
  for (const p of portal) portalByKey.set(invoiceKey(p.gstin, p.number), p);
  const seen = new Set<string>();
  const out: ReconRow[] = [];
  for (const b of books) {
    const key = invoiceKey(b.gstin, b.number);
    const p = portalByKey.get(key);
    const bookFigures = { id: b.id, taxable: b.taxable, cgst: b.cgst, sgst: b.sgst, igst: b.igst };
    if (!p || seen.has(key)) {
      out.push({
        status: 'MISSING_IN_2B',
        gstin: b.gstin,
        supplier: b.supplier,
        number: b.number,
        date: b.date,
        books: bookFigures,
        portal: null,
        differences: [],
      });
      continue;
    }
    seen.add(key);
    const differences: string[] = [];
    if (!close(b.taxable, p.taxable)) differences.push('taxable value');
    if (!close(b.cgst, p.cgst)) differences.push('CGST');
    if (!close(b.sgst, p.sgst)) differences.push('SGST');
    if (!close(b.igst, p.igst)) differences.push('IGST');
    out.push({
      status: differences.length ? 'MISMATCH' : 'MATCHED',
      gstin: b.gstin,
      supplier: b.supplier,
      number: b.number,
      date: b.date,
      books: bookFigures,
      portal: { taxable: p.taxable, cgst: p.cgst, sgst: p.sgst, igst: p.igst },
      differences,
    });
  }
  for (const p of portal) {
    if (seen.has(invoiceKey(p.gstin, p.number))) continue;
    out.push({
      status: 'MISSING_IN_BOOKS',
      gstin: p.gstin,
      supplier: p.supplier,
      number: p.number,
      date: p.date,
      books: null,
      portal: { taxable: p.taxable, cgst: p.cgst, sgst: p.sgst, igst: p.igst },
      differences: [],
    });
  }
  return out;
}
