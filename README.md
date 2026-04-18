# Jobs Scraper Framework (Node.js + Playwright + SQLite)

This project crawls query URLs across:
- robota.ua
- work.ua
- djinni.co
- jobs.dou.ua
- deftech.dou.ua

It extracts job title + canonical URL, stores normalized records in SQLite, and stops pagination per source/query as soon as the first already-known job is encountered for that query.

## Features

- Unified internal job record shape:
  - `source`
  - `queryKey`
  - `canonicalUrl`
  - `title`
  - `externalId`
  - `scrapedAt`
- Per-source adapter interface:
  - `extractJobs(page, query)`
  - `resolveNext(page, query, state)`
- Canonical URL normalization:
  - force `https`
  - remove fragments
  - strip tracking params
  - normalize trailing slash
  - source-specific path normalization
- SQLite dedupe core:
  - unique job URL storage (`jobs.canonical_url`)
  - query-known tracking (`query_seen`)
- Stop rule:
  - while traversing newest -> older
  - stop only the current query when first known URL for that query appears
- Resilience:
  - retries + exponential backoff
  - conservative per-source rate limiting
- CLI modes:
  - full run
  - single-query debug run
- Per-query summary:
  - pages visited
  - new rows
  - stop trigger
  - errors
- Telegram notifications for new jobs (optional)

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Optional Telegram setup:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

When configured, crawler sends new jobs in this format:

```text
{queryKey} - {count} new jobs:
- title, url
```

## Run

Full crawl:

```bash
npm run crawl
```

Single query debug run:

```bash
npm run crawl:debug -- --query work_remote_it --max-pages 5
```

## Query Configuration

All provided URLs are configured in `src/config/queries.js` with stable `queryKey` values.

## Database

Default SQLite path: `data/jobs.sqlite`

Schema includes:
- `jobs` with unique `canonical_url`
- `query_seen` for per-query known URL tracking
- query-oriented indexes for retrieval performance

Inspect DB quality and uniqueness:

```bash
npm run db:stats
```

Clean database (remove malformed rows and orphan query markers):

```bash
npm run db:cleanup
```

## Verification Procedure

1. First run:

```bash
npm run crawl
```

Expect non-zero inserts on active queries.

2. Immediate second run (same DB):

```bash
npm run crawl
```

Expect stop-on-first-known behavior and near-zero inserts.

3. Validate uniqueness and canonical quality:

```bash
npm run db:stats
```

4. Run one debug query per source:

```bash
npm run crawl:debug -- --query robota_ukraine_it_parttime --max-pages 3
npm run crawl:debug -- --query work_remote_it --max-pages 3
npm run crawl:debug -- --query djinni_remote_all --max-pages 3
npm run crawl:debug -- --query dou_remote --max-pages 3
```

## Notes

- Website layouts can change; each adapter includes fallback selectors.
- Some sources may throttle, block, or challenge headless traffic. Retries and conservative pacing are built in, but occasional selector updates may still be needed.
