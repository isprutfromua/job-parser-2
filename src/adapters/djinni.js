const { canonicalizeUrl } = require("../utils/canonicalize");

const LISTING_SELECTORS = [
  "a[href*='/jobs/'][href*='-']",
  ".job-list-item a[href*='/jobs/']",
  "a.profile[href*='/jobs/']",
];

function parseExternalId(url) {
  const match = url.match(/\/jobs\/(\d+)-/);
  return match ? match[1] : null;
}

function isVacancyUrl(href) {
  return /^https?:\/\/djinni\.co\/jobs\/\d+-/.test(href);
}

async function extractJobs(page, query) {
  const rows = await page.evaluate((selectors) => {
    const out = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const anchor of document.querySelectorAll(selector)) {
        const href = anchor.href;
        const title = (anchor.textContent || "").trim().replace(/\s+/g, " ");

        if (!href || !title || seen.has(href)) {
          continue;
        }

        if (!/\/jobs\/\d+-/.test(href)) {
          continue;
        }

        seen.add(href);
        out.push({ href, title });
      }
    }

    return out;
  }, LISTING_SELECTORS);

  if (!rows.length) {
    const fallback = await page.evaluate(() => {
      const out = [];
      const seen = new Set();

      for (const anchor of document.querySelectorAll("a[href]")) {
        const href = anchor.href;
        const title = (anchor.textContent || "").trim().replace(/\s+/g, " ");

        if (!href || !title || seen.has(href)) {
          continue;
        }

        if (!/\/jobs\/\d+-/.test(href)) {
          continue;
        }

        seen.add(href);
        out.push({ href, title });
      }

      return out;
    });

    rows.push(...fallback);
  }

  return rows
    .filter((row) => isVacancyUrl(row.href))
    .map((row) => {
      const canonicalUrl = canonicalizeUrl(row.href, query.source);
      return {
        source: query.source,
        queryKey: query.queryKey,
        canonicalUrl,
        title: row.title,
        externalId: parseExternalId(row.href),
      };
    })
    .filter((row) => row.canonicalUrl);
}

async function resolveNext(page, query, state) {
  const current = new URL(state.currentUrl);
  const currentPage = Number(current.searchParams.get("page") || "1");
  const nextPage = currentPage + 1;

  current.searchParams.set("page", String(nextPage));

  const maybeNext = current.toString();
  return { kind: "url", value: maybeNext, validateContentChange: true };
}

module.exports = {
  name: "djinni",
  extractJobs,
  resolveNext,
};
