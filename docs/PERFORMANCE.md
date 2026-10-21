# Performance baseline

Measured with `apps/api/test/perf.manual.int.test.ts` (skipped unless `PERF=1`). One API process, local
PostgreSQL 16 and Redis on the same machine, so network time is excluded: these numbers show what the application
and its queries cost, not what a user on the internet sees. 30 requests per endpoint (10 for the org chart, 20 for
the integration API), after seeding the stated number of employees into one organisation.

Run it yourself: `PERF=1 PERF_EMPLOYEES=20000 pnpm --filter @smart-hr/api exec vitest run --project integration test/perf.manual.int.test.ts`

| Endpoint                                   | 3,000 people p50 / p95 | 20,000 people p50 / p95 |
| ------------------------------------------ | ---------------------- | ----------------------- |
| `GET /v1/employees` (50 per page)          | 39 / 52 ms             | 48 / 76 ms              |
| `GET /v1/employees?search=`                | 31 / 36 ms             | 47 / 61 ms              |
| `GET /v1/search`                           | 38 / 54 ms             | 61 / 76 ms              |
| `GET /v1/me/home`                          | 44 / 78 ms             | 53 / 142 ms             |
| `GET /v1/employees/org-chart`              | 60 / 66 ms             | 114 / 128 ms            |
| `GET /v1/integrations/api/employees` (200) | 19 / 45 ms             | 27 / 48 ms              |

## Reading the results

- Every endpoint stays well under the test ceilings (1.5 to 5 seconds) at both sizes. Growing the organisation
  almost sevenfold roughly doubled the slowest (org chart) and barely moved list and search.
- The org chart is the one to watch: it returns the whole tree, so it grows with headcount. Fine at 20,000;
  beyond roughly 50,000 people it should load level by level.
- `/v1/me/home` p95 is the noisiest figure (several queries per request); the p50 is flat.
- Not measured here: serverless cold starts on Vercel (typically a second or two for the first request after idle),
  Neon wake-up after its idle suspend, and the 10 to 60 second function time limits. Measure these on staging.
