# @smart-hr/auth

Security primitives used by the API's auth module. No I/O, no framework code.

| Module              | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `password.ts`       | argon2id hashing and verification, password policy              |
| `tokens.ts`         | Random opaque tokens and their SHA-256 storage hashes           |
| `secret-box.ts`     | AES-256-GCM encryption for secrets at rest (TOTP secrets)       |
| `totp.ts`           | RFC 6238 TOTP enrolment and verification with replay protection |
| `recovery-codes.ts` | One-time MFA recovery codes                                     |

See [docs/security/AUTHENTICATION.md](../../docs/security/AUTHENTICATION.md).
