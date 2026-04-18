const { canonicalizeUrl } = require("../utils/canonicalize");

const DOU_SELECTORS = [
  "a.vt",
  "a[href*='/vacancies/']",
  ".vacancy a[href*='/vacancies/']",
];

const DEFTECH_SELECTORS = [
  "a[href*='deftech.dou.ua/jobs/']",
  "a[href*='/jobs/']",
  ".l-vacancy a",
];

function parseExternalId(url) {
  const douMatch = url.match(/\/vacancies\/(\d+)/);
  if (douMatch) {
    return douMatch[1];
  }

  const deftechMatch = url.match(/\/jobs\/(\d+)/);
  return deftechMatch ? deftechMatch[1] : null;
}

function isVacancyUrl(url, family) {
  if (family === "dou") {
    return /jobs\.dou\.ua\/vacancies\/\d+/.test(url);
  }

  return /deftech\.dou\.ua\/jobs\/\d+/.test(url);
}

async function extractJobs(page, query) {
  const selectors = query.family === "dou" ? DOU_SELECTORS : DEFTECH_SELECTORS;

  const rows = await page.evaluate((selectorList) => {
    const out = [];
    const seen = new Set();

    for (const selector of selectorList) {
      for (const anchor of document.querySelectorAll(selector)) {
        const href = anchor.href;
        const title = (anchor.textContent || "").trim().replace(/\s+/g, " ");

        if (!href || !title || seen.has(href)) {
          continue;
        }

        if (!/\/(vacancies|jobs)\/\d+/.test(href)) {
          continue;
        }

        seen.add(href);
        out.push({ href, title });
      }
    }

    return out;
  }, selectors);

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

        if (!/\/(vacancies|jobs)\/\d+/.test(href)) {
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
    .filter((row) => isVacancyUrl(row.href, query.family))
    .map((row) => {
      const canonicalUrl = canonicalizeUrl(row.href, query.source);
      return {
        source: query.family === "dou" ? "dou" : "deftech",
        queryKey: query.queryKey,
        canonicalUrl,
        title: row.title,
        externalId: parseExternalId(row.href),
      };
    })
    .filter((row) => row.canonicalUrl);
}

async function resolveNext(page) {
  const hasLoadMore = await page.evaluate(() => {
    const selectors = [
      ".more-btn a",
      "a.more-btn",
      "button.more-btn",
      "a[href*='more']",
      "button:has-text('Більше вакансій')",
    ];

    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  });

  if (!hasLoadMore) {
    return null;
  }

  return {
    kind: "click",
    selector: ".more-btn a, a.more-btn, button.more-btn",
  };
}

module.exports = {
  name: "dou_family",
  extractJobs,
  resolveNext,
};
