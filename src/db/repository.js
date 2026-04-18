const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  query_key TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  external_id TEXT,
  scraped_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(canonical_url)
);

CREATE TABLE IF NOT EXISTS query_seen (
  query_key TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(query_key, canonical_url)
);

CREATE INDEX IF NOT EXISTS idx_jobs_query_scraped_at
  ON jobs(query_key, scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_source_query
  ON jobs(source, query_key);

CREATE INDEX IF NOT EXISTS idx_query_seen_query_key
  ON query_seen(query_key);
`;

class Repository {
  constructor(dbPath) {
    const directory = path.dirname(dbPath);
    if (directory && directory !== ".") {
      fs.mkdirSync(directory, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);

    this.insertJobStmt = this.db.prepare(`
      INSERT OR IGNORE INTO jobs (
        source,
        query_key,
        canonical_url,
        title,
        external_id,
        scraped_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.insertSeenStmt = this.db.prepare(`
      INSERT OR IGNORE INTO query_seen (
        query_key,
        canonical_url
      ) VALUES (?, ?)
    `);

    this.insertRecordTxn = this.db.transaction((record) => {
      const insertedJob = this.insertJobStmt.run(
        record.source,
        record.queryKey,
        record.canonicalUrl,
        record.title,
        record.externalId,
        record.scrapedAt,
      ).changes > 0;

      const insertedSeen = this.insertSeenStmt.run(
        record.queryKey,
        record.canonicalUrl,
      ).changes > 0;

      return {
        insertedJob,
        insertedSeen,
      };
    });
  }

  loadKnownByQuery(queryKeys) {
    const knownByQuery = new Map();
    for (const queryKey of queryKeys) {
      knownByQuery.set(queryKey, new Set());
    }

    const placeholders = queryKeys.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT query_key, canonical_url FROM query_seen WHERE query_key IN (${placeholders})`,
      )
      .all(...queryKeys);

    for (const row of rows) {
      if (!knownByQuery.has(row.query_key)) {
        knownByQuery.set(row.query_key, new Set());
      }
      knownByQuery.get(row.query_key).add(row.canonical_url);
    }

    return knownByQuery;
  }

  saveRecord(record) {
    return this.insertRecordTxn(record);
  }

  getStats() {
    const jobs = this.db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count;
    const seen = this.db.prepare("SELECT COUNT(*) AS count FROM query_seen").get().count;

    return {
      jobs,
      seen,
    };
  }

  listDuplicateCanonicalUrls(limit = 20) {
    return this.db
      .prepare(
        `
        SELECT canonical_url, COUNT(*) as c
        FROM jobs
        GROUP BY canonical_url
        HAVING c > 1
        LIMIT ?
      `,
      )
      .all(limit);
  }

  listCanonicalQualityIssues(limit = 20) {
    return this.db
      .prepare(
        `
        SELECT canonical_url, title
        FROM jobs
        WHERE canonical_url LIKE 'http://%'
           OR title = ''
           OR canonical_url = ''
        LIMIT ?
      `,
      )
      .all(limit);
  }

  cleanup() {
    const deletedBadJobs = this.db.prepare(
      `
      DELETE FROM jobs
      WHERE title = ''
         OR canonical_url = ''
         OR canonical_url IS NULL
         OR canonical_url LIKE 'http://%'
    `,
    ).run().changes;

    const deletedBadSeen = this.db.prepare(
      `
      DELETE FROM query_seen
      WHERE canonical_url = ''
         OR canonical_url IS NULL
    `,
    ).run().changes;

    const deletedOrphanSeen = this.db.prepare(
      `
      DELETE FROM query_seen
      WHERE canonical_url NOT IN (
        SELECT canonical_url FROM jobs
      )
    `,
    ).run().changes;

    this.db.pragma("wal_checkpoint(TRUNCATE)");
    this.db.exec("VACUUM");

    return {
      deletedBadJobs,
      deletedBadSeen,
      deletedOrphanSeen,
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = {
  Repository,
};
