# Staging and early-production cost estimate

Estimate only. List prices were read from the providers' pricing pages on 2026-10-21 and change often; check
them again before committing budget. Usage assumptions are ours, not measured on a live deployment.

## List prices used

| Service       | Price used                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel Pro    | $20 per developer seat per month, with $20 monthly usage credit; usage beyond that is pay as you go. Viewers are free.                            |
| Neon Launch   | No monthly minimum. $0.106 per compute-unit hour, $0.35 per GB-month storage. Compute suspends after 5 minutes idle (not billed while suspended). |
| Neon Scale    | $0.222 per compute-unit hour, $0.35 per GB-month, configurable or no autosuspend.                                                                 |
| Upstash Redis | Free: 500K commands/month, 250 MB. Pay as you go: $0.20 per 100K commands, $0.25 per GB after the first. Fixed 250 MB plan: $10.                  |
| S3            | About $0.023 to $0.025 per GB-month (Standard) plus request and transfer charges; the AWS pricing page for the chosen region is authoritative.    |

## Scenarios

|                           | Staging (demo, a few users)                   | Early production (about 500 employees, always on)                                                                 |
| ------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Vercel                    | $20 (one seat, two projects)                  | $20 to $40 (one or two seats; usage mostly inside the credit)                                                     |
| Neon                      | $0 to $5 (Free or Launch, suspends when idle) | $40 to $80 (Launch with autosuspend off, about 0.5 to 1 compute unit)                                             |
| Upstash                   | $0 (free tier)                                | $0 to $10 (cron sweeps every 5 minutes are about 9K invocations a month; command count is the unknown, see below) |
| S3                        | under $1                                      | $1 to $5 (tens of GB of documents)                                                                                |
| Email (SMTP provider)     | $0 (free tier)                                | $0 to $20                                                                                                         |
| AI (Bedrock or Anthropic) | $0 until enabled                              | usage based; org budgets cap it                                                                                   |
| **Total**                 | **about $20 to $30 a month**                  | **about $60 to $150 a month**                                                                                     |

## What would move the numbers

- **Neon compute** is the largest variable. A database that never suspends costs roughly one compute unit times
  730 hours: about $77 on Launch and $162 on Scale per unit. Keep Launch with autosuspend for staging.
- **Upstash commands** depend on how the queue is used on serverless. Measure on staging: one week of real use
  gives the monthly figure; at $0.20 per 100K, 5 million commands is $10.
- **Vercel usage beyond the credit** comes from function time, bandwidth and the 5-minute cron fan-out. Watch the
  usage page in the first week.
- **Documents and exports** grow S3 storage and transfer; both are small next to compute.
- **AI** is separate and capped by the monthly token budget each organisation sets.

## Cheaper or steadier alternatives

If a fixed bill matters more than zero idle cost, the in-house Docker Compose deployment (`deploy/inhouse`) on
one small server avoids per-request pricing entirely. The trade is that backups, patching and uptime become yours.
