import { describe, expect, it } from 'vitest';
import { cleanFileName, contentDisposition, detectFileKind } from './file-types.js';

const bytes = (...b: number[]) => Uint8Array.from(b);
const text = (s: string) => new TextEncoder().encode(s);

describe('detectFileKind', () => {
  it('recognises accepted files by their content', () => {
    expect(detectFileKind(text('%PDF-1.7\n...'), 'offer.pdf')?.mimeType).toBe('application/pdf');
    expect(detectFileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), 'a.PNG')?.mimeType).toBe(
      'image/png',
    );
    expect(detectFileKind(bytes(0xff, 0xd8, 0xff, 0xe0), 'photo.jpeg')?.mimeType).toBe('image/jpeg');
    expect(detectFileKind(text('RIFF\0\0\0\0WEBPVP8 '), 'x.webp')?.mimeType).toBe('image/webp');
    expect(detectFileKind(bytes(0x50, 0x4b, 0x03, 0x04, 1), 'cv.docx')?.label).toBe('Word document');
    expect(detectFileKind(text('a,b\n1,2\n'), 'list.csv')?.mimeType).toBe('text/csv');
    expect(detectFileKind(text('notes — fine'), 'notes.txt')?.mimeType).toBe('text/plain');
  });

  it('refuses a name that disagrees with the content', () => {
    expect(detectFileKind(text('%PDF-1.7'), 'offer.png')).toBeNull();
    expect(detectFileKind(text('<html><script>alert(1)</script>'), 'page.html')).toBeNull();
    expect(detectFileKind(text('<html></html>'), 'page.pdf')).toBeNull();
    expect(detectFileKind(bytes(0x50, 0x4b, 0x03, 0x04), 'archive.zip')).toBeNull();
    expect(detectFileKind(bytes(0x4d, 0x5a, 0x90, 0), 'setup.exe')).toBeNull();
    expect(detectFileKind(bytes(0x4d, 0x5a, 0, 0), 'setup.txt')).toBeNull();
    expect(detectFileKind(new Uint8Array(), 'empty.txt')).toBeNull();
  });
});

describe('file names', () => {
  it('keeps the base name only and strips control and reserved characters', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\Users\\a\\offer "final".pdf')).toBe('offer final.pdf');
    expect(cleanFileName('...')).toBe('document');
    expect(cleanFileName('a\u0000b\r\n.pdf')).toBe('ab.pdf');
    expect(cleanFileName('Offer – Priya.pdf')).toBe('Offer - Priya.pdf');
  });

  it('encodes download names safely', () => {
    expect(contentDisposition('Offer – Priya.pdf')).toBe(
      `attachment; filename="Offer _ Priya.pdf"; filename*=UTF-8''Offer%20%E2%80%93%20Priya.pdf`,
    );
  });
});
