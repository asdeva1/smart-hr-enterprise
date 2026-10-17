# Documents and e-signatures

Phase 12. Plan features: `documents` (every plan) and `esignature` (Premium and Enterprise). Decisions and
limits: [ADR 0010](../decisions/0010-document-storage-and-esignatures.md).

## Employee documents

Documents live on employee records: contracts, ID copies, certificates, letters, medical notes. Each has a
title, category, optional expiry date, optional HR notes and a "share with the employee" switch.

| Who                                    | Sees                                                | Can                                                                      |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| `documents.view` where the employee is | All their documents, including HR-only and archived | Download                                                                 |
| `documents.manage` where they are      | The same                                            | Upload, change details, archive, make letters, send for signature        |
| The employee (linked sign-in)          | Their active documents that are shared with them    | Download, add their own documents (always shared with them, no HR notes) |
| Anyone else, managers included         | Nothing; the API answers 404                        | —                                                                        |

Files are encrypted at rest and checked against their SHA-256 when read. Downloads are audited
(`document.download`). Uploads, changes and archiving are audited too. A document that is out for signature
can't be archived, and an archived document can't be changed (the database refuses it).

`/v1/documents/expiring?days=30` lists documents that have expired or soon will, for the employees in the
member's `documents.view` scopes.

## Letter templates

`documents.configure` maintains templates: text with placeholders such as `{{employee.name}}`,
`{{employee.designation}}`, `{{employee.joinDate}}`, `{{organisation.name}}` and `{{today}}`. Unknown
placeholders are refused when the template is saved. HR picks a template on an employee's Documents tab, sees
the filled-in text, and makes it: the letter is a PDF added to the employee's documents.

## Signatures

HR sends a PDF document for signature to one or more members (the employee is offered first), in order or
all at once, with an optional deadline and message.

1. Signers whose turn it is get a notification and an email linking to the request.
2. They download and read the document, confirm the declaration, type their name and sign. Signing needs a
   recent password entry. The document's SHA-256 is checked against the one fixed when it was sent.
3. In order, the next signer is then told. A signer can decline with a reason, which closes the request.
4. When everyone has signed, the signed copy (original pages plus a signature certificate listing each
   signer, their typed name, time and network address, and the document's SHA-256) is added to the
   employee's documents and everyone involved is told.

The sender or HR can cancel an open request. The worker closes requests past their deadline (`EXPIRED`) and
tells the sender and anyone still to sign.

## Reminders

The worker's document sweep (`DOCUMENT_SWEEP_INTERVAL_MS`, hourly by default) tells whoever added a document,
and the employee if it is shared with them, `DOCUMENT_REMINDER_DAYS` (default 30) before it expires, once per
expiry date. Changing the expiry date sends a new reminder later.

## Configuration

| Variable                 | Default         | Meaning                                                            |
| ------------------------ | --------------- | ------------------------------------------------------------------ |
| `STORAGE_DRIVER`         | `local`         | Where file bytes go. Only `local` for now (S3 with the AWS phase). |
| `STORAGE_LOCAL_DIR`      | `.data/storage` | Directory for `local`; `/var/lib/smart-hr/documents` in-house.     |
| `DOCUMENT_MAX_UPLOAD_MB` | `10`            | Largest upload.                                                    |
| `DOCUMENT_REMINDER_DAYS` | `30`            | Worker: days before expiry that the reminder goes out.             |

Back up the storage directory together with the database (the in-house `backup.sh` does both); each is
useless without the other, and both need `DATA_ENCRYPTION_KEYS`.

## API

| Method and path                                                         | Purpose                                    |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| `GET /v1/documents/me`                                                  | My documents                               |
| `GET /v1/documents/employee/:id`                                        | An employee's documents (`?status=ALL`)    |
| `POST /v1/documents/employee/:id` (multipart `file`)                    | Upload                                     |
| `GET /v1/documents/:id`, `GET /v1/documents/:id/file`                   | One document, download                     |
| `PATCH /v1/documents/:id`, `POST /v1/documents/:id/archive`             | Change details, archive                    |
| `GET /v1/documents/expiring`                                            | Expiring documents                         |
| `GET/POST /v1/documents/templates`, `PATCH …/:id`                       | Letter templates                           |
| `GET /v1/documents/employee/:id/letters/preview`, `POST …/letters`      | Preview and make a letter                  |
| `POST /v1/documents/:id/signatures`                                     | Send for signature                         |
| `GET /v1/signatures?scope=mine\|sent\|all`, `GET /v1/signatures/people` | Requests, signer lookup                    |
| `GET /v1/signatures/:id`, `…/document`, `…/signed`                      | One request, the document, the signed copy |
| `POST /v1/signatures/:id/sign\|decline\|cancel`                         | Answer or cancel                           |
