const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'research.db'));

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
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
    hIndex INTEGER DEFAULT 0,
    email TEXT,
    country TEXT
  );

  CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    abstract TEXT,
    source TEXT NOT NULL,
    category_id TEXT,
    citations_count INTEGER DEFAULT 0,
    impact_factor REAL DEFAULT 1.0,
    published_year INTEGER NOT NULL,
    doi TEXT,
    url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS paper_authors (
    paper_id TEXT,
    author_id TEXT,
    role TEXT DEFAULT 'Co-Author',
    PRIMARY KEY (paper_id, author_id),
    FOREIGN KEY(paper_id) REFERENCES papers(id) ON DELETE CASCADE,
    FOREIGN KEY(author_id) REFERENCES authors(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_papers_category ON papers(category_id);
  CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(published_year);
  CREATE INDEX IF NOT EXISTS idx_papers_citations ON papers(citations_count);
  CREATE INDEX IF NOT EXISTS idx_papers_source ON papers(source);
`);

module.exports = db;
