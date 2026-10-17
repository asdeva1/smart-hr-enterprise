# 0010 — Encrypted document storage and in-app electronic signatures

- Status: accepted
- Date: 2026-10-18
- Builds on [ADR 0002](0002-tenancy-and-rls.md) (tenancy) and [ADR 0004](0004-deployment-modes.md) (deployment modes)

## Decision

**Storage.** Uploaded and generated files are encrypted in the API process with AES-256-GCM, using the
organisation-data key ring (`DATA_ENCRYPTION_KEYS`, the same keys as identity and bank details). Each file is
bound to its organisation and id as associated data, so a file copied to another row or organisation won't
open. The format (`SHB1 | key id | iv | tag | ciphertext`) carries its key id, so rotated keys still open older
files. The database keeps the metadata (`stored_file`: name, type, size, SHA-256 of the plaintext, key id) and
the runtime role can only insert and read it. Every read is checked against the stored SHA-256. Bytes live
behind a small `FileStorage` interface; `STORAGE_DRIVER=local` writes them to a directory (a volume in the
in-house stack, backed up by `backup.sh`). An S3 driver comes with the AWS phase, with the same encryption,
so object storage never holds plaintext.

**What may be uploaded.** The content decides, not the name or the browser's claim: PDF, PNG, JPEG, WebP,
Word (.docx), Excel (.xlsx), text and CSV, with an extension that agrees with the content. Size is capped by
`DOCUMENT_MAX_UPLOAD_MB` (default 10) and total storage by the plan's `storage.gb` limit. Downloads are
always attachments with `nosniff`, `no-store` and a restrictive CSP, and every download is audited.

**Signatures.** Signing happens in Smart HR by signed-in members of the organisation, not by emailed links.
Only PDFs are sent, because the signed copy is the original pages plus a signature certificate page. When a
request is sent, its document's SHA-256 is fixed, and it is checked again before every signature. A signer
must have entered their password recently, confirm they read the document and agree to sign electronically,
and type their name; the name, time, network address and browser are recorded. Requests can go in order or
to everyone at once, can have a deadline, and can be declined (with a reason) or cancelled. Database
triggers make a signature, a refusal and a closed request final, and column grants stop anyone rewriting
who was asked or what was sent. The completed copy is stored as a new document on the employee's record.

## Why

- Encrypting before storage means the disk, a backup or a misconfigured bucket never exposes documents, and
  the key ring is already managed and rotated for personal data.
- Content sniffing with matching extensions blocks the usual tricks (HTML or scripts renamed `.pdf`,
  executables renamed `.txt`) without a converter in the request path.
- In-app signing reuses the identity we already prove strongly (password, optional MFA, recent auth) instead
  of bearer links that can be forwarded. A certificate page plus a fixed hash gives a self-contained record
  that anyone holding the signed copy can read.

## Not covered (yet)

- External signers without an account, and cryptographic (PKI/Aadhaar eSign) signatures. The certificate is
  an audit record, not a digital signature over the PDF.
- Virus scanning of uploads (needs a scanner service; planned with the AWS phase).
- File bytes in the organisation data export: the export lists every file with its SHA-256; a bulk download
  of the files themselves comes later.
- Letters use the standard PDF fonts, so characters outside Western European scripts are replaced; upload a
  finished PDF for those.
