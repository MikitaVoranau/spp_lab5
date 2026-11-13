const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'analytics.db'));

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL,
    reviewer_name TEXT NOT NULL,
    rating INTEGER CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS metrics (
    paper_id TEXT PRIMARY KEY,
    views_count INTEGER DEFAULT 0,
    downloads_count INTEGER DEFAULT 0,
    altmetric_score REAL DEFAULT 0.0,
    trending_rank INTEGER DEFAULT 999999
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL,
    tag TEXT DEFAULT 'General',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_reviews_paper ON reviews(paper_id);
  CREATE INDEX IF NOT EXISTS idx_metrics_views ON metrics(views_count);
  CREATE INDEX IF NOT EXISTS idx_metrics_downloads ON metrics(downloads_count);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_paper ON bookmarks(paper_id);
`);

module.exports = db;
