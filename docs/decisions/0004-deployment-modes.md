# 0004 — One image, three deployment modes

- Status: accepted
- Date: 2026-10-13

## Decision

The same container images run in every deployment model. `DEPLOYMENT_MODE` (`saas`, `dedicated`, `inhouse`) selects where entitlements come from and whether control-plane modules (tenant onboarding, billing, metering) load.

|                                               | SaaS                 | Dedicated            | In-house                                   |
| --------------------------------------------- | -------------------- | -------------------- | ------------------------------------------ |
| Tenants per database                          | many                 | one                  | one                                        |
| Entitlements                                  | subscription records | subscription records | signed licence (Ed25519), verified offline |
| Needs Smartclues control plane for daily work | yes                  | billing only         | no                                         |

Licence expiry is non-destructive: after the grace period, writes in paid modules stop; data, exports and admin remain. There is no remote kill switch.

Web fonts are self-hosted from npm rather than fetched from Google at build time, so builds work without internet access.

## Why

- One codebase to test and patch.
- In-house customers must be able to run without reaching our servers.
