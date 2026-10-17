/**
 * Which files may be uploaded, judged by their content, not by the name or the type the browser claims.
 * The extension must agree with the content, so a renamed executable or HTML page is refused.
 */
export interface FileKind {
  mimeType: string;
  extensions: string[];
  label: string;
}

const KINDS = {
  pdf: { mimeType: 'application/pdf', extensions: ['pdf'], label: 'PDF' },
  png: { mimeType: 'image/png', extensions: ['png'], label: 'PNG image' },
  jpeg: { mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'], label: 'JPEG image' },
  webp: { mimeType: 'image/webp', extensions: ['webp'], label: 'WebP image' },
  docx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    label: 'Word document',
  },
  xlsx: {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
    label: 'Excel workbook',
  },
  txt: { mimeType: 'text/plain', extensions: ['txt'], label: 'Text file' },
  csv: { mimeType: 'text/csv', extensions: ['csv'], label: 'CSV file' },
} satisfies Record<string, FileKind>;

export const ALLOWED_FILE_LABELS = 'PDF, PNG, JPEG, WebP, Word (.docx), Excel (.xlsx), text or CSV';

const startsWith = (buf: Uint8Array, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

function isPlainText(buf: Uint8Array): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** The kind of an uploaded file, or null when it isn't one we accept. */
export function detectFileKind(buf: Uint8Array, fileName: string): FileKind | null {
  const ext = extensionOf(fileName);
  let kind: FileKind | null = null;
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) kind = KINDS.pdf;
  else if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) kind = KINDS.png;
  else if (startsWith(buf, [0xff, 0xd8, 0xff])) kind = KINDS.jpeg;
  else if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8))
    kind = KINDS.webp;
  else if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // Office files are zip archives; the extension says which (other zips are refused).
    kind = ext === 'docx' ? KINDS.docx : ext === 'xlsx' ? KINDS.xlsx : null;
  } else if (buf.length > 0 && isPlainText(buf)) {
    kind = ext === 'csv' ? KINDS.csv : ext === 'txt' ? KINDS.txt : null;
  }
  if (!kind || !kind.extensions.includes(ext)) return null;
  return kind;
}

/** A file name safe to store and to send back in a download header. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    // Control characters (U+0000–U+001F, U+007F) and characters file systems reserve.
    .replace(/[\p{Cc}"<>:|?*]/gu, '')
    // Dashes as plain hyphens: some browsers drop a download name containing them.
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-150);
  return cleaned.replace(/^\.+/, '') || 'document';
}

/** `Content-Disposition` for a download, with a plain fallback and the exact name (RFC 6266 / 5987). */
export function contentDisposition(fileName: string, inline = false): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
