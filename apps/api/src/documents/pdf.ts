import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.12, 0.13, 0.16);
const MUTED = rgb(0.4, 0.42, 0.46);

/**
 * The standard PDF fonts only cover Western European characters. Anything else (₹, Devanagari, …) is
 * written as "?" rather than failing; letters needing other scripts should be uploaded as finished PDFs.
 */
function writable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text.replace(/\t/g, '    ')]
    .map((ch) => (ch === '\n' || supported.has(ch.codePointAt(0)!) ? ch : ch === '₹' ? 'Rs.' : '?'))
    .join('');
}

function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the line is broken by characters.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  page!: PDFPage;
  y = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly footer: string,
    private readonly fonts: { regular: PDFFont; bold: PDFFont },
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
    this.page.drawText(writable(this.fonts.regular, this.footer), {
      x: MARGIN,
      y: MARGIN / 2,
      size: 8,
      font: this.fonts.regular,
      color: MUTED,
    });
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: typeof INK; gap?: number } = {}) {
    const size = opts.size ?? 11;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const leading = size * 1.45;
    for (const line of wrap(font, size, writable(font, text), A4[0] - MARGIN * 2)) {
      if (this.y - leading < MARGIN) this.newPage();
      this.y -= leading;
      if (line) this.page.drawText(line, { x: MARGIN, y: this.y, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.gap ?? 0;
  }
}

/** A letter: organisation name, title and body text, on A4 pages. */
export async function renderLetterPdf(input: {
  organisation: string;
  title: string;
  body: string;
  footer: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setProducer('Smart HR');
  doc.setCreator('Smart HR');
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const w = new Writer(doc, input.footer, fonts);
  w.text(input.organisation, { size: 10, bold: true, color: MUTED, gap: 18 });
  w.text(input.title, { size: 16, bold: true, gap: 14 });
  w.text(input.body);
  return doc.save();
}

export interface CertificateSigner {
  name: string;
  email: string;
  signedName: string;
  signedAt: Date;
  ipAddress: string | null;
}

/**
 * The signed copy: the original pages unchanged, followed by a signature certificate recording who signed,
 * when, from where, and the SHA-256 of the document they were shown.
 */
export async function appendCertificate(
  original: Uint8Array,
  info: {
    requestId: string;
    title: string;
    organisation: string;
    documentSha256: string;
    requestedBy: string;
    sentAt: Date;
    completedAt: Date;
    signers: CertificateSigner[];
  },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const w = new Writer(doc, `Signature certificate · request ${info.requestId}`, fonts);
  const when = (d: Date) => `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
  w.text('Signature certificate', { size: 16, bold: true, gap: 6 });
  w.text(
    `This page records the electronic signatures on "${info.title}" for ${info.organisation}. ` +
      'Each signer was signed in to Smart HR, confirmed they had read the document, agreed to sign it electronically and typed their name.',
    { size: 10, color: MUTED, gap: 12 },
  );
  w.text(`Request: ${info.requestId}`, { size: 10 });
  w.text(`Sent by: ${info.requestedBy}, ${when(info.sentAt)}`, { size: 10 });
  w.text(`Completed: ${when(info.completedAt)}`, { size: 10 });
  w.text(`Document SHA-256 (before this page): ${info.documentSha256}`, { size: 10, gap: 14 });
  info.signers.forEach((s, i) => {
    w.text(`${i + 1}. ${s.name} <${s.email}>`, { size: 11, bold: true });
    w.text(`Signed as "${s.signedName}" on ${when(s.signedAt)}${s.ipAddress ? ` from ${s.ipAddress}` : ''}`, {
      size: 10,
      gap: 8,
    });
  });
  return doc.save();
}

/** True when the bytes open as a PDF we can add pages to (not encrypted, not damaged). */
export async function isEditablePdf(data: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(data, { updateMetadata: false });
    return doc.getPageCount() > 0;
  } catch {
    return false;
  }
}
