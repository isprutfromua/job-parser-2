const { canonicalizeUrl } = require("../utils/canonicalize");

const LISTING_SELECTORS = [
  "a[href*='/vacancy/']",
  "a[href*='/vacancy']",
  "a[href*='/company'][href*='/vacancy']",
  "a[href*='vacancy'][data-id]",
];

const TITLE_SELECTORS = [
  "h1",
  "h2",
  "h3",
  "[itemprop='title']",
  "[data-qa*='title']",
  "[data-qa*='vacancy']",
  "[class*='vacancy-title']",
  "[class*='job-title']",
  "[class*='position']",
  "[class*='title']",
];

function parseExternalId(url) {
  const match = url.match(/\/vacancy\/?(\d+)/);
  return match ? match[1] : null;
}

function isVacancyUrl(href) {
  return /^https?:\/\/robota\.ua\/.+\/vacancy\/?(\d+)/.test(href) || /\/vacancy\/?(\d+)/.test(href);
}

async function extractJobs(page, query) {
  await page
    .waitForFunction(
      () => {
        return document.querySelectorAll("a[href*='/vacancy']").length > 0;
      },
      { timeout: 8000 },
    )
    .catch(() => {});

  const rows = await page.evaluate(({ selectors, titleSelectors }) => {
    const clean = (value) => (value || "").trim().replace(/\s+/g, " ");

    const extractTitle = (anchor) => {
      for (const selector of titleSelectors) {
        const el = anchor.querySelector(selector);
        if (!el) {
          continue;
        }

        const text = clean(el.textContent);
        if (text && text.length <= 180) {
          return text;
        }
      }

      return "";
    };

    const out = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const anchor of document.querySelectorAll(selector)) {
        const href = anchor.href;
        const title = extractTitle(anchor);

        if (!href || !title || seen.has(href)) {
          continue;
        }

        if (!/\/vacancy\/?\d+/.test(href)) {
          continue;
        }

        seen.add(href);
        out.push({ href, title });
      }
    }

    return out;
  }, { selectors: LISTING_SELECTORS, titleSelectors: TITLE_SELECTORS });

  if (!rows.length) {
    const fallback = await page.evaluate(() => {
      const clean = (value) => (value || "").trim().replace(/\s+/g, " ");

      const out = [];
      const seen = new Set();

      for (const anchor of document.querySelectorAll("a[href]")) {
        const href = anchor.href;
        const titleEl = anchor.querySelector("h1, h2, h3, [itemprop='title'], [data-qa*='title']");
        const title = clean(titleEl ? titleEl.textContent : "");

        if (!href || !title || seen.has(href)) {
          continue;
        }

        if (!/\/vacancy\/?\d+/.test(href)) {
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

async function resolveNext(page) {
  const href = await page.evaluate(() => {
    const nextSelectors = [
      "a[rel='next']",
      "a[aria-label*='Наступна']",
      "a[aria-label*='Next']",
      ".pagination a.next",
      "a[href*='page='][class*='next']",
    ];

    for (const selector of nextSelectors) {
      const next = document.querySelector(selector);
      if (next && next.href) {
        return next.href;
      }
    }

    const current = document.querySelector(".pagination .active, .pagination [aria-current='page']");
    const links = Array.from(document.querySelectorAll(".pagination a[href*='page=']"));

    if (!current) {
      return null;
    }

    const currentPage = Number((current.textContent || "").trim());
    if (!Number.isFinite(currentPage)) {
      return null;
    }

    const nextNumeric = links.find((link) => Number((link.textContent || "").trim()) === currentPage + 1);
    return nextNumeric ? nextNumeric.href : null;
  });

  return href ? { kind: "url", value: href } : null;
}

module.exports = {
  name: "robota",
  extractJobs,
  resolveNext,
};
