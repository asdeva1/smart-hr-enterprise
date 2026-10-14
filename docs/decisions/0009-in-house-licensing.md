# 0009 — Offline, signed licences for in-house installations

- Status: accepted
- Date: 2026-10-14
- Builds on [ADR 0004](0004-deployment-modes.md) (one image, three deployment modes)

## Decision

An in-house installation (`DEPLOYMENT_MODE=inhouse`) takes every organisation's modules and limits from one
signed licence, verified on the server with Ed25519 public keys. Nothing contacts Smartclues.

- **Format.** `SHRL1.<base64url JSON>.<base64url signature>`. The signature covers the prefix and payload.
  The payload names the customer, plan, modules, limits, support level, validity window, grace days, how
  many organisations the installation may hold, and optionally the installation it is bound to.
- **Keys.** Installations hold public keys only (`LICENCE_PUBLIC_KEYS=keyId:base64,…`, several allowed for
  rotation). The issuing key never leaves Smartclues; the `smart-hr-licence` tool reads it from a file and
  never prints it. The API refuses to start in-house without at least one public key.
- **Binding.** Each installation gets a random id in its first migration. The runtime role can read but not
  change it. A licence may name that id; a licence for another installation is refused on install and
  read-only if found.
- **Installing.** Platform operators paste the licence on the Licence page (recent password entry
  required). Forged, unknown-key, expired and wrong-installation licences are refused and the attempt is
  audited. Installing replaces the current licence; history is kept and nothing is deleted.
- **Lapses.** Valid → grace (everything works, banner shown) → expired (paid modules read-only). A stored
  licence that no longer verifies, is not valid yet, or names another installation is read-only too. In
  every case data stays readable and exportable; there is no remote kill switch.
- **No self-granting.** In-house, subscriptions, add-ons and overrides are ignored for entitlements and
  their write endpoints return `409 SUBSCRIPTIONS_NOT_USED`, so an installation's own operators cannot
  enable modules the licence doesn't include.

## Why

- Hospitals, BPOs and government customers often run without outbound internet. Verification must be
  local and deterministic.
- Ed25519 keys and signatures are small enough to paste, and Node verifies them without dependencies.
- Making every failure read-only (never hidden) keeps the promise that customer data is never held hostage.

## Consequences

- A forged licence would need the private key, but someone with database superuser access can always read
  the data directly. The licence protects commercial terms, not confidentiality.
- Clock rollback on the server can extend a licence. Accepted: in-house customers are contracted, and the
  audit log records every licence install.
- The web image bakes in `NEXT_PUBLIC_API_URL` at build time, so in-house web images are built per
  installation. A runtime-configurable API address is a known gap.
