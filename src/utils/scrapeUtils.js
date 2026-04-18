function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff(task, options = {}) {
  const {
    retries = 3,
    initialDelayMs = 1000,
    factor = 2,
    onRetry,
  } = options;

  let attempt = 0;
  let waitMs = initialDelayMs;

  while (attempt <= retries) {
    try {
      return await task(attempt + 1);
    } catch (error) {
      attempt += 1;
      if (attempt > retries) {
        throw error;
      }

      if (onRetry) {
        onRetry({ attempt, waitMs, error });
      }

      const jitter = Math.floor(Math.random() * 250);
      await delay(waitMs + jitter);
      waitMs *= factor;
    }
  }

  throw new Error("Unreachable retry state");
}

async function gotoWithRetry(page, url, logger, options = {}) {
  return retryWithBackoff(
    async () => {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs || 45000,
      });

      if (!response) {
        return null;
      }

      const status = response.status();
      if (status >= 500) {
        throw new Error(`HTTP ${status} for ${url}`);
      }

      return response;
    },
    {
      retries: options.retries ?? 2,
      initialDelayMs: options.initialDelayMs ?? 1200,
      onRetry: ({ attempt, waitMs, error }) => {
        logger.warn(
          {
            url,
            attempt,
            waitMs,
            error: error.message,
          },
          "Retrying page navigation",
        );
      },
    },
  );
}

async function clickLoadMore(page, selector, logger) {
  const control = page.locator(selector).first();
  if (!(await control.count())) {
    return false;
  }

  const before = await page.locator("a[href]").count();

  await control.scrollIntoViewIfNeeded();
  await control.click({ timeout: 15000 });

  await page.waitForFunction(
    ({ selector: buttonSelector, beforeCount }) => {
      const links = document.querySelectorAll("a[href]").length;
      const button = document.querySelector(buttonSelector);
      return links > beforeCount || !button;
    },
    { selector, beforeCount: before },
    { timeout: 15000 },
  ).catch(() => {
    logger.warn({ selector }, "Load-more click did not show observable changes");
  });

  return true;
}

async function evaluateAnchors(page, predicateSource) {
  return page.$$eval(
    "a[href]",
    (anchors, predicateString) => {
      const predicate = new Function("href", `return (${predicateString})(href)`);
      return anchors
        .map((a) => {
          return {
            href: a.href,
            title: (a.textContent || "").trim().replace(/\s+/g, " "),
          };
        })
        .filter((item) => item.href && item.title && predicate(item.href));
    },
    predicateSource,
  );
}

module.exports = {
  delay,
  retryWithBackoff,
  gotoWithRetry,
  clickLoadMore,
  evaluateAnchors,
};
