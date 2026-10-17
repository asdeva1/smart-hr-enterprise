import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Line } from './payroll-calc.js';

const INK = rgb(0.12, 0.13, 0.16);
const MUTED = rgb(0.4, 0.42, 0.46);
const RULE = rgb(0.85, 0.86, 0.88);

/** Standard PDF fonts are Western European only; write ₹ as Rs. and anything else unsupported as "?". */
function safe(font: PDFFont, text: string) {
  const ok = new Set(font.getCharacterSet());
  return [...text]
    .map((c) => (ok.has(c.codePointAt(0)!) ? c : c === '₹' ? 'Rs.' : c === '•' ? '*' : '?'))
    .join('');
}

const inr = (n: number) =>
  `Rs. ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n))}`;

export interface PayslipPdfInput {
  company: string;
  period: string;
  draft: boolean;
  employee: {
    name: string;
    code: string;
    designation: string | null;
    department: string | null;
    joined: string;
    pan: string | null;
    bank: string | null;
    uan: string | null;
  };
  days: { inMonth: number; paid: number; lop: number };
  earnings: Line[];
  deductions: Line[];
  gross: number;
  totalDeductions: number;
  net: number;
}

/** A one-page A4 payslip: who, the month, earnings beside deductions, and net pay. */
export async function renderPayslipPdf(input: PayslipPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Payslip ${input.period} - ${input.employee.name}`);
  doc.setProducer('Smart HR');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page: PDFPage = doc.addPage([595.28, 841.89]);
  const left = 48;
  const right = 547;
  let y = 790;
  const text = (t: string, x: number, size = 10, font = regular, color = INK) =>
    page.drawText(safe(font, t), { x, y, size, font, color });
  const textRight = (t: string, x: number, size = 10, font = regular) => {
    const s = safe(font, t);
    page.drawText(s, { x: x - font.widthOfTextAtSize(s, size), y, size, font, color: INK });
  };
  const rule = () =>
    page.drawLine({
      start: { x: left, y: y - 6 },
      end: { x: right, y: y - 6 },
      thickness: 0.75,
      color: RULE,
    });

  text(input.company, left, 14, bold);
  textRight(`Payslip for ${input.period}`, right, 12, bold);
  y -= 18;
  if (input.draft) {
    text('DRAFT - not yet approved', left, 10, bold, rgb(0.7, 0.2, 0.1));
    y -= 14;
  }
  rule();
  y -= 22;
  const facts: [string, string][] = [
    ['Employee', `${input.employee.name} (${input.employee.code})`],
    ['Designation', input.employee.designation ?? '-'],
    ['Department', input.employee.department ?? '-'],
    ['Date of joining', input.employee.joined],
    ['PAN', input.employee.pan ?? '-'],
    ['UAN', input.employee.uan ?? '-'],
    ['Bank account', input.employee.bank ?? '-'],
    [
      'Days',
      `${input.days.paid} paid of ${input.days.inMonth}${input.days.lop ? `, ${input.days.lop} loss of pay` : ''}`,
    ],
  ];
  for (let i = 0; i < facts.length; i += 2) {
    for (const [j, x] of [
      [i, left],
      [i + 1, 300],
    ] as const) {
      const f = facts[j];
      if (!f) continue;
      text(f[0], x, 9, regular, MUTED);
      text(f[1], x + 85, 9);
    }
    y -= 16;
  }
  y -= 10;
  rule();
  y -= 22;
  text('Earnings', left, 11, bold);
  textRight('Amount', 280, 11, bold);
  text('Deductions', 310, 11, bold);
  textRight('Amount', right, 11, bold);
  y -= 8;
  rule();
  y -= 18;
  const rows = Math.max(input.earnings.length, input.deductions.length);
  for (let i = 0; i < rows; i++) {
    const e = input.earnings[i];
    const d = input.deductions[i];
    if (e) {
      text(e.name, left);
      textRight(inr(e.amount), 280);
    }
    if (d) {
      text(d.name, 310);
      textRight(inr(d.amount), right);
    }
    y -= 16;
  }
  rule();
  y -= 20;
  text('Gross pay', left, 10, bold);
  textRight(inr(input.gross), 280, 10, bold);
  text('Total deductions', 310, 10, bold);
  textRight(inr(input.totalDeductions), right, 10, bold);
  y -= 34;
  text('Net pay', left, 14, bold);
  textRight(inr(input.net), right, 14, bold);
  y -= 40;
  text(
    'This payslip was produced by Smart HR from approved payroll and needs no signature.',
    left,
    8,
    regular,
    MUTED,
  );
  return doc.save();
}
