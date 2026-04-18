const { canonicalizeUrl } = require("../utils/canonicalize");

const LISTING_SELECTORS = [
  "h2 a[href*='/jobs/']",
  "a[href*='/jobs/'][data-ga-event*='vacancy']",
  ".job-link",
  "a.ga_listing",
];

const BLOCKLIST_CONTAINER_SELECTORS = [
  ".hot-jobs",
  ".promo",
  ".ad-entity",
  ".recommendation",
  "[data-qa='recommendation']",
];

function parseExternalId(url) {
  const match = url.match(/\/jobs\/(\d+)/);
  return match ? match[1] : null;
}

function isVacancyUrl(href) {
  return /^https?:\/\/www\.work\.ua\/jobs-\d+/.test(href) || /\/jobs\/(\d+)/.test(href);
}

async function extractJobs(page, query) {
  const items = await page.evaluate(
    ({ selectors, blockSelectors }) => {
      const seen = new Set();
      const results = [];

      const isBlocked = (node) => {
        if (!node) {
          return false;
        }

        return blockSelectors.some((selector) => node.closest(selector));
      };

      for (const selector of selectors) {
        const anchors = document.querySelectorAll(selector);

        for (const anchor of anchors) {
          const href = anchor.href;
          const title = (anchor.textContent || "").trim().replace(/\s+/g, " ");

          if (!href || !title || seen.has(href) || isBlocked(anchor)) {
            continue;
          }

          if (!/\/jobs\/\d+/.test(href) && !/\/jobs-\d+/.test(href)) {
            continue;
          }

          seen.add(href);
          results.push({ href, title });
        }
      }

      return results;
    },
    {
      selectors: LISTING_SELECTORS,
      blockSelectors: BLOCKLIST_CONTAINER_SELECTORS,
    },
  );

  if (!items.length) {
    const fallback = await page.evaluate(() => {
      const out = [];
      const seen = new Set();

      for (const anchor of document.querySelectorAll("a[href]")) {
        const href = anchor.href;
        const title = (anchor.textContent || "").trim().replace(/\s+/g, " ");

        if (!href || !title || seen.has(href)) {
          continue;
        }

        if (!/\/jobs\/(\d+)/.test(href) && !/\/jobs-\d+/.test(href)) {
          continue;
        }

        seen.add(href);
        out.push({ href, title });
      }

      return out;
    });

    items.push(...fallback);
  }

  return items
    .filter((item) => isVacancyUrl(item.href))
    .map((item) => {
      const canonicalUrl = canonicalizeUrl(item.href, query.source);
      return {
        source: query.source,
        queryKey: query.queryKey,
        canonicalUrl,
        title: item.title,
        externalId: parseExternalId(item.href),
      };
    })
    .filter((row) => row.canonicalUrl);
}

async function resolveNext(page) {
  const href = await page.evaluate(() => {
    const selectors = [
      "a[rel='next']",
      "a[title*='Наступна']",
      ".pagination a.next",
      ".pagination a[aria-label*='Next']",
      "a[href*='page='][class*='next']",
    ];

    for (const selector of selectors) {
      const anchor = document.querySelector(selector);
      if (anchor && anchor.href) {
        return anchor.href;
      }
    }

    const pageLinks = Array.from(document.querySelectorAll(".pagination a[href*='page=']"));
    const current = document.querySelector(".pagination .active, .pagination .selected");

    if (!current || !current.textContent) {
      return null;
    }

    const currentPage = Number((current.textContent || "").trim());
    if (Number.isNaN(currentPage)) {
      return null;
    }

    const next = pageLinks.find((link) => Number((link.textContent || "").trim()) === currentPage + 1);
    return next ? next.href : null;
  });

  return href ? { kind: "url", value: href } : null;
}

module.exports = {
  name: "work",
  extractJobs,
  resolveNext,
};
