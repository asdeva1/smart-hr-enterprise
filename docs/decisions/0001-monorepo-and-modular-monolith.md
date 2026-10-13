# 0001 — Monorepo and modular monolith

- Status: accepted
- Date: 2026-10-13

## Decision

One pnpm + Turborepo monorepo holding three deployable apps (`api`, `worker`, `web`) and shared packages. The API is a modular monolith: each business domain is a NestJS module that owns its tables and talks to other domains only through exported services or domain events.

All code is native ES modules (`"type": "module"`, TypeScript `NodeNext`), because NestJS 12 ships as ESM only.

## Why

- One product, one release train, many deployment models — a single codebase is required by the brief.
- A monolith keeps transactions simple for payroll and accounting, where cross-module consistency matters.
- Clear module boundaries keep the option to extract a service later, if load or team ownership demands it.

## Consequences

- Packages are built to `dist/` with `tsc`; Turborepo builds dependencies first.
- Packages without a real need stay as placeholder folders (no `package.json`) until their phase.
- Pinned versions: TypeScript 6.0 (typescript-eslint does not support 7.0 yet) and Prisma 7.10 (8.0 is still a release candidate).
