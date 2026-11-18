const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'research',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function waitForDB(retries = 15, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('[Analytics DB] PostgreSQL connected.');
      return;
    } catch (err) {
      if (i < retries - 1) {
        console.log(`[Analytics DB] Waiting for PostgreSQL... (${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw new Error('[Analytics DB] Cannot connect to PostgreSQL: ' + err.message);
      }
    }
  }
}

async function initAnalyticsSchema() {
  await waitForDB();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      reviewer_name TEXT NOT NULL,
      rating INTEGER CHECK(rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_paper     ON reviews(paper_id);
    CREATE INDEX IF NOT EXISTS idx_metrics_views     ON metrics(views_count);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_paper   ON bookmarks(paper_id);
  `);
  console.log('[Analytics DB] Schema ready.');
}

module.exports = { pool, initAnalyticsSchema };
