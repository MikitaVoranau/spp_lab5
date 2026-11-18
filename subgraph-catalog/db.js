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
      console.log('[Catalog DB] PostgreSQL connected.');
      return;
    } catch (err) {
      if (i < retries - 1) {
        console.log(`[Catalog DB] Waiting for PostgreSQL... (${i + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw new Error('[Catalog DB] Cannot connect to PostgreSQL: ' + err.message);
      }
    }
  }
}

async function initCatalogSchema() {
  await waitForDB();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS authors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      affiliation TEXT,
      h_index INTEGER DEFAULT 0,
      email TEXT,
      country TEXT
    );

    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      abstract TEXT,
      source TEXT NOT NULL,
      category_id TEXT REFERENCES categories(id),
      citations_count INTEGER DEFAULT 0,
      impact_factor REAL DEFAULT 1.0,
      published_year INTEGER NOT NULL,
      doi TEXT,
      url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS paper_authors (
      paper_id TEXT REFERENCES papers(id) ON DELETE CASCADE,
      author_id TEXT REFERENCES authors(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'Co-Author',
      PRIMARY KEY (paper_id, author_id)
    );

    CREATE INDEX IF NOT EXISTS idx_papers_category   ON papers(category_id);
    CREATE INDEX IF NOT EXISTS idx_papers_year       ON papers(published_year);
    CREATE INDEX IF NOT EXISTS idx_papers_citations  ON papers(citations_count);
    CREATE INDEX IF NOT EXISTS idx_papers_source     ON papers(source);
  `);

  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_papers_title_trgm ON papers USING gin(title gin_trgm_ops);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_papers_abstract_trgm ON papers USING gin(abstract gin_trgm_ops);`);
  } catch (_) {}

  console.log('[Catalog DB] Schema ready.');
}

function mapPaper(row) {
  return {
    id: row.id,
    title: row.title,
    abstract: row.abstract,
    source: row.source,
    categoryId: row.category_id,
    citationsCount: row.citations_count,
    impactFactor: row.impact_factor,
    publishedYear: row.published_year,
    doi: row.doi,
    url: row.url,
  };
}

module.exports = { pool, initCatalogSchema, mapPaper };
