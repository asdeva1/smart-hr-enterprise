/** First and last day of a month given as "2026-04". */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Save rows as a CSV file in the browser. Cells that start with = + - @ are prefixed so a spreadsheet won't run them. */
export function downloadCsv(name: string, header: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    let s = v === null ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export interface Tax {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}
export interface Gstr1Doc extends Tax {
  id: string;
  number: string | null;
  date: string;
  customer: string;
  gstin: string | null;
  placeOfSupply: string | null;
  total: number;
  against?: { number: string | null; date: string } | null;
}
export interface Gstr1 {
  seller: { gstin: string | null; stateCode: string | null };
  b2b: Gstr1Doc[];
  b2cl: Gstr1Doc[];
  b2cs: (Tax & { pos: string | null; rate: number })[];
  cdnr: Gstr1Doc[];
  cdnur: Gstr1Doc[];
  hsn: (Tax & { hsn: string; rate: number; unit: string | null; quantity: number; value: number })[];
  totals: { invoices: Tax; creditNotes: Tax; net: Tax };
  warnings: { sellerGstinMissing: boolean; documentsWithoutHsn: string[] };
}
export interface Gstr3b {
  heads: { head: 'igst' | 'cgst' | 'sgst'; output: number; itc: number; payable: number }[];
  outward: { taxable: number };
  itc: { taxable: number };
  netPayable: number;
  note: string;
}
export interface PurchaseRegister {
  rows: (Tax & {
    id: string;
    type: 'BILL' | 'DEBIT_NOTE';
    number: string | null;
    vendorBillNo: string | null;
    date: string;
    vendor: string;
    gstin: string | null;
    total: number;
  })[];
  totals: Tax;
}
export interface TdsReport {
  rows: {
    vendor: { id: string; name: string; pan: string | null };
    rate: number;
    base: number;
    tds: number;
    bills: number;
  }[];
  detail: {
    id: string;
    type: string;
    number: string | null;
    date: string;
    vendor: string;
    rate: number;
    base: number;
    tds: number;
  }[];
  total: number;
  vendorsWithoutPan: string[];
}
export type ReconStatus = 'MATCHED' | 'MISMATCH' | 'MISSING_IN_BOOKS' | 'MISSING_IN_2B';
export interface Reconciliation {
  rows: {
    status: ReconStatus;
    gstin: string;
    supplier: string | null;
    number: string;
    date: string | null;
    books: (Tax & { id: string }) | null;
    portal: Tax | null;
    differences: string[];
  }[];
  counts: { matched: number; mismatch: number; missingInBooks: number; missingIn2b: number };
  skipped: { billsWithoutGstinOrNumber: number };
}
export const RECON_LABEL: Record<ReconStatus, string> = {
  MATCHED: 'Matched',
  MISMATCH: 'Differs',
  MISSING_IN_BOOKS: 'Not in your books',
  MISSING_IN_2B: 'Not in GSTR-2B',
};
export const RECON_TONE = {
  MATCHED: 'success',
  MISMATCH: 'warning',
  MISSING_IN_BOOKS: 'danger',
  MISSING_IN_2B: 'danger',
} as const;
