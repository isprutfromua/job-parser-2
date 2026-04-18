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
const DEFAULT_CONCURRENT_QUERIES = Number(process.env.CONCURRENT_QUERIES || 3);

const SOURCE_RATE_LIMIT_MS = {
  robota: Number(process.env.RATE_LIMIT_ROBOTA_MS || 900),
  work: Number(process.env.RATE_LIMIT_WORK_MS || 800),
  djinni: Number(process.env.RATE_LIMIT_DJINNI_MS || 900),
  dou_family: Number(process.env.RATE_LIMIT_DOU_FAMILY_MS || 700),
};
const RATE_LIMIT_MIN_DELAY_MS = Number(process.env.RATE_LIMIT_MIN_DELAY_MS || 150);
const RATE_LIMIT_JITTER_MS = Number(process.env.RATE_LIMIT_JITTER_MS || 150);

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

function sourceDelayMs(source, jobsOnCurrentPage = 0) {
  const configured = SOURCE_RATE_LIMIT_MS[source] || 800;
  const adaptiveBase = jobsOnCurrentPage > 0 ? Math.floor(configured * 0.6) : configured;
  const jitter = RATE_LIMIT_JITTER_MS > 0 ? Math.floor(Math.random() * RATE_LIMIT_JITTER_MS) : 0;
  return Math.max(RATE_LIMIT_MIN_DELAY_MS, adaptiveBase + jitter);
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
    url: query.url,
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

        await delay(sourceDelayMs(query.source, extracted.length));
        await gotoWithRetry(page, next.value, logger, {
          retries: NAV_RETRIES,
          timeoutMs: NAV_TIMEOUT_MS,
        });

        if (next.validateContentChange && previousTopJob && page.url() === currentUrl) {
          summary.stopTrigger = {
            type: "content-not-changed",
            page: pageNumber,
            url: next.value,
          };
          return summary;
        }

        currentUrl = next.value;
      } else if (next.kind === "click") {
        await delay(sourceDelayMs(query.source, extracted.length));
        const clickResult = await clickLoadMore(page, next.selector, logger);
        if (!clickResult.found) {
          summary.stopTrigger = { type: "load-more-not-found", page: pageNumber };
          return summary;
        }
        if (!clickResult.changed) {
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

async function runCrawler({ queryKey, maxPages, concurrency }) {
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
  const safeConcurrency = Math.max(1, Math.min(concurrency || DEFAULT_CONCURRENT_QUERIES, selectedQueries.length));

  try {
    runSummaries.length = selectedQueries.length;

    let nextIndex = 0;

    const runOne = async (index) => {
      const query = selectedQueries[index];
      const adapter = ADAPTERS[query.source];
      if (!adapter) {
        runSummaries[index] = {
          queryKey: query.queryKey,
          title: query.title,
          url: query.url,
          source: query.source,
          pagesVisited: 0,
          newRows: 0,
          newJobs: [],
          stopTrigger: { type: "adapter-missing" },
          errors: [`No adapter for source ${query.source}`],
        };
        return;
      }

      const page = await context.newPage();
      try {
        runSummaries[index] = await processQuery({
          page,
          query,
          adapter,
          repository,
          baselineKnown,
          mutableKnown: knownByQuery,
          logger,
          maxPages,
        });
      } finally {
        await page.close();
      }
    };

    const workers = Array.from({ length: safeConcurrency }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= selectedQueries.length) {
          return;
        }

        await runOne(currentIndex);
      }
    });

    await Promise.all(workers);
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
    .option("--concurrency <number>", "Number of queries to process in parallel", String(DEFAULT_CONCURRENT_QUERIES))
    .option("--cleanup-db", "Cleanup database and exit", false);

  program.parse(process.argv);

  const options = program.opts();

  if (options.cleanupDb) {
    runDatabaseCleanup();
    return;
  }

  const requestedMaxPages = Number(options.maxPages || String(MAX_PAGES_CAP));
  const requestedConcurrency = Number(options.concurrency || String(DEFAULT_CONCURRENT_QUERIES));

  if (!Number.isFinite(requestedMaxPages) || requestedMaxPages <= 0) {
    throw new Error(`Invalid --max-pages value: ${options.maxPages}`);
  }
  if (!Number.isFinite(requestedConcurrency) || requestedConcurrency <= 0) {
    throw new Error(`Invalid --concurrency value: ${options.concurrency}`);
  }

  const maxPages = Math.min(requestedMaxPages, MAX_PAGES_CAP);
  const concurrency = Math.floor(requestedConcurrency);

  const result = await runCrawler({
    queryKey: options.query,
    maxPages,
    concurrency,
  });

  printSummary(result);
  await maybeNotifyTelegram(result, createLogger());
}

main().catch((error) => {
  console.error("Crawler failed:", error.message);
  process.exitCode = 1;
});
