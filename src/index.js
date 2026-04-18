#!/usr/bin/env node

require("dotenv").config();

const path = require("path");
const { chromium } = require("playwright");
const { Command } = require("commander");

const { QUERIES, getQueryByKey } = require("./config/queries");
const { ADAPTERS } = require("./adapters");
const { Repository } = require("./db/repository");
const { createLogger } = require("./logger");
const { delay, gotoWithRetry, clickLoadMore } = require("./utils/scrapeUtils");
const {
  buildNotificationGroups,
  chunkLines,
  sendTelegramMessages,
} = require("./utils/telegram");

const MAX_PAGES_CAP = 5;

const SOURCE_RATE_LIMIT_MS = {
  robota: Number(process.env.RATE_LIMIT_ROBOTA_MS || 1800),
  work: Number(process.env.RATE_LIMIT_WORK_MS || 1600),
  djinni: Number(process.env.RATE_LIMIT_DJINNI_MS || 1800),
  dou_family: Number(process.env.RATE_LIMIT_DOU_FAMILY_MS || 1500),
};

const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || 20000);
const NAV_RETRIES = Number(process.env.NAV_RETRIES || 1);

function isoNow() {
  return new Date().toISOString();
}

function cloneKnownMap(knownByQuery) {
  const out = new Map();
  for (const [queryKey, set] of knownByQuery.entries()) {
    out.set(queryKey, new Set(set));
  }
  return out;
}

async function processQuery({
  page,
  query,
  adapter,
  repository,
  baselineKnown,
  mutableKnown,
  logger,
  maxPages,
}) {
  const summary = {
    queryKey: query.queryKey,
    source: query.source,
    title: query.title,
    pagesVisited: 0,
    newRows: 0,
    newJobs: [],
    stopTrigger: null,
    errors: [],
  };

  const processedInRun = new Set();
  const knownAtStart = baselineKnown.get(query.queryKey) || new Set();
  if (!mutableKnown.has(query.queryKey)) {
    mutableKnown.set(query.queryKey, new Set());
  }
  const knownMutable = mutableKnown.get(query.queryKey);
  let currentUrl = query.url;
  let pageNumber = 1;
  let emptyPageStreak = 0;

  try {
    await gotoWithRetry(page, currentUrl, logger, {
      retries: NAV_RETRIES,
      timeoutMs: NAV_TIMEOUT_MS,
    });

    while (pageNumber <= maxPages) {
      summary.pagesVisited += 1;

      const extracted = await adapter.extractJobs(page, query);

      if (!extracted.length) {
        emptyPageStreak += 1;
        logger.warn({ queryKey: query.queryKey, page: pageNumber }, "No jobs found on page");
      } else {
        emptyPageStreak = 0;
      }

      if (emptyPageStreak >= 2) {
        summary.stopTrigger = { type: "empty-pages", page: pageNumber };
        return summary;
      }

      for (const job of extracted) {
        if (!job.canonicalUrl || !job.title) {
          continue;
        }

        if (processedInRun.has(job.canonicalUrl)) {
          continue;
        }

        if (knownAtStart.has(job.canonicalUrl)) {
          summary.stopTrigger = {
            type: "known-job",
            canonicalUrl: job.canonicalUrl,
            page: pageNumber,
          };
          return summary;
        }

        const record = {
          ...job,
          scrapedAt: isoNow(),
        };

        const result = repository.saveRecord(record);
        processedInRun.add(job.canonicalUrl);

        knownMutable.add(job.canonicalUrl);

        if (result.insertedJob) {
          summary.newRows += 1;
          summary.newJobs.push({
            title: record.title,
            canonicalUrl: record.canonicalUrl,
          });
        }
      }

      const next = await adapter.resolveNext(page, query, {
        pageNumber,
        currentUrl,
      });

      if (!next) {
        summary.stopTrigger = { type: "no-next-page", page: pageNumber };
        return summary;
      }

      if (next.kind === "url") {
        const previousTopJob = extracted[0] ? extracted[0].canonicalUrl : null;

        await delay(SOURCE_RATE_LIMIT_MS[query.source] || 1500);
        await gotoWithRetry(page, next.value, logger, {
          retries: NAV_RETRIES,
          timeoutMs: NAV_TIMEOUT_MS,
        });

        if (next.validateContentChange && previousTopJob) {
          const after = await adapter.extractJobs(page, query);
          const newTopJob = after[0] ? after[0].canonicalUrl : null;
          if (!newTopJob || newTopJob === previousTopJob) {
            summary.stopTrigger = {
              type: "content-not-changed",
              page: pageNumber,
              url: next.value,
            };
            return summary;
          }
        }

        currentUrl = next.value;
      } else if (next.kind === "click") {
        const beforeFirst = extracted[0] ? extracted[0].canonicalUrl : null;
        const beforeCount = extracted.length;

        await delay(SOURCE_RATE_LIMIT_MS[query.source] || 1500);
        const clicked = await clickLoadMore(page, next.selector, logger);
        if (!clicked) {
          summary.stopTrigger = { type: "load-more-not-found", page: pageNumber };
          return summary;
        }

        const after = await adapter.extractJobs(page, query);
        const afterFirst = after[0] ? after[0].canonicalUrl : null;
        if (after.length <= beforeCount && beforeFirst === afterFirst) {
          summary.stopTrigger = { type: "load-more-no-change", page: pageNumber };
          return summary;
        }
      } else {
        summary.stopTrigger = { type: "unknown-pagination-state", page: pageNumber };
        return summary;
      }

      pageNumber += 1;
    }

    summary.stopTrigger = { type: "max-pages", page: maxPages };
    return summary;
  } catch (error) {
    summary.errors.push(error.message);
    summary.stopTrigger = { type: "error", page: pageNumber };
    return summary;
  }
}

async function runCrawler({ queryKey, maxPages }) {
  const logger = createLogger();
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "jobs.sqlite");
  const repository = new Repository(dbPath);

  const selectedQueries = queryKey
    ? [getQueryByKey(queryKey)].filter(Boolean)
    : QUERIES;

  if (!selectedQueries.length) {
    throw new Error(`Unknown queryKey: ${queryKey}`);
  }

  const knownByQuery = repository.loadKnownByQuery(selectedQueries.map((q) => q.queryKey));
  const baselineKnown = cloneKnownMap(knownByQuery);

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 2200 },
  });

  const runSummaries = [];

  try {
    for (const query of selectedQueries) {
      const adapter = ADAPTERS[query.source];
      if (!adapter) {
        runSummaries.push({
          queryKey: query.queryKey,
          title: query.title,
          source: query.source,
          pagesVisited: 0,
          newRows: 0,
          newJobs: [],
          stopTrigger: { type: "adapter-missing" },
          errors: [`No adapter for source ${query.source}`],
        });
        continue;
      }

      const page = await context.newPage();
      const summary = await processQuery({
        page,
        query,
        adapter,
        repository,
        baselineKnown,
        mutableKnown: knownByQuery,
        logger,
        maxPages,
      });

      runSummaries.push(summary);
      await page.close();
    }
  } finally {
    await context.close();
    await browser.close();
    repository.close();
  }

  return {
    runSummaries,
    dbPath,
  };
}

function printSummary(result) {
  console.log("\nCrawl summary");
  console.log("=============");

  for (const item of result.runSummaries) {
    console.log(`${item.queryKey} (${item.source})`);
    console.log(`  pages visited: ${item.pagesVisited}`);
    console.log(`  new rows: ${item.newRows}`);
    console.log(`  stop trigger: ${JSON.stringify(item.stopTrigger)}`);

    if (item.errors.length) {
      for (const err of item.errors) {
        console.log(`  error: ${err}`);
      }
    }
  }

  const totals = result.runSummaries.reduce(
    (acc, item) => {
      acc.pages += item.pagesVisited;
      acc.newRows += item.newRows;
      acc.errors += item.errors.length;
      return acc;
    },
    { pages: 0, newRows: 0, errors: 0 },
  );

  console.log("\nTotals");
  console.log(`  total pages: ${totals.pages}`);
  console.log(`  total new rows: ${totals.newRows}`);
  console.log(`  total errors: ${totals.errors}`);
  console.log(`  db path: ${result.dbPath}`);
}

async function maybeNotifyTelegram(result, logger) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return;
  }

  const groups = buildNotificationGroups(result.runSummaries);
  const messages = groups.flatMap((group) => chunkLines(group.lines));

  if (!messages.length) {
    logger.info("No new jobs to send to Telegram");
    return;
  }

  await sendTelegramMessages({
    botToken,
    chatId,
    messages,
  });

  logger.info({ chunks: messages.length }, "Sent Telegram notification");
}

function runDatabaseCleanup() {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "jobs.sqlite");
  const repository = new Repository(dbPath);

  try {
    const cleanupResult = repository.cleanup();
    const stats = repository.getStats();
    console.log("DB cleanup completed");
    console.log(cleanupResult);
    console.log(stats);
  } finally {
    repository.close();
  }
}

async function main() {
  const program = new Command();

  program
    .name("jobs-crawler")
    .description("Playwright + SQLite jobs scraper framework")
    .option("-q, --query <queryKey>", "Run a single query in debug mode")
    .option("--max-pages <number>", "Maximum pages per query", String(MAX_PAGES_CAP))
    .option("--cleanup-db", "Cleanup database and exit", false);

  program.parse(process.argv);

  const options = program.opts();

  if (options.cleanupDb) {
    runDatabaseCleanup();
    return;
  }

  const requestedMaxPages = Number(options.maxPages || String(MAX_PAGES_CAP));

  if (!Number.isFinite(requestedMaxPages) || requestedMaxPages <= 0) {
    throw new Error(`Invalid --max-pages value: ${options.maxPages}`);
  }

  const maxPages = Math.min(requestedMaxPages, MAX_PAGES_CAP);

  const result = await runCrawler({
    queryKey: options.query,
    maxPages,
  });

  printSummary(result);
  await maybeNotifyTelegram(result, createLogger());
}

main().catch((error) => {
  console.error("Crawler failed:", error.message);
  process.exitCode = 1;
});
