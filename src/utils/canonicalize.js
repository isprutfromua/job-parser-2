const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "from",
]);

function ensureHttps(urlObj) {
  urlObj.protocol = "https:";
}

function stripTracking(urlObj) {
  for (const key of [...urlObj.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
      urlObj.searchParams.delete(key);
    }
  }
}

function normalizeSlash(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function sourceSpecificPath(source, pathname) {
  if (source === "work") {
    const match = pathname.match(/\/jobs\/(\d+)/);
    if (match) {
      return `/jobs/${match[1]}`;
    }
  }

  if (source === "robota") {
    const match = pathname.match(/\/company\d+\/vacancy\/?(\d+)/) || pathname.match(/\/vacancy\/?(\d+)/);
    if (match) {
      return `/vacancy/${match[1]}`;
    }
  }

  if (source === "djinni") {
    const match = pathname.match(/\/jobs\/(\d+)-[^/]+/);
    if (match) {
      return `/jobs/${match[1]}`;
    }
  }

  if (source === "dou_family") {
    const douVacancy = pathname.match(/\/vacancies\/(\d+)/);
    if (douVacancy) {
      return `/vacancies/${douVacancy[1]}`;
    }

    const deftechVacancy = pathname.match(/\/jobs\/(\d+)/);
    if (deftechVacancy) {
      return `/jobs/${deftechVacancy[1]}`;
    }
  }

  return normalizeSlash(pathname);
}

function canonicalizeUrl(rawUrl, source) {
  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  ensureHttps(parsed);
  parsed.hash = "";
  stripTracking(parsed);
  parsed.pathname = sourceSpecificPath(source, parsed.pathname);

  const canonical = parsed.toString();
  return canonical.endsWith("/") ? canonical.slice(0, -1) : canonical;
}

module.exports = {
  canonicalizeUrl,
};
