require('dotenv').config();
const crypto = require('crypto');
const axios = require('axios');
const xml2js = require('xml2js');
const { pool } = require('./db');

const OPENALEX_EMAIL = process.env.OPENALEX_EMAIL || 'research.nexus@example.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CATEGORIES = [
  { id: 'cat-ai',    name: 'Artificial Intelligence & ML',  domain: 'Computer Science',       description: 'Deep learning, LLMs, reinforcement learning and neural architectures.' },
  { id: 'cat-qc',    name: 'Quantum Computing',             domain: 'Physics & Engineering',   description: 'Qubits, quantum algorithms, error correction, and supremacy.' },
  { id: 'cat-bio',   name: 'Biotechnology & Genomics',      domain: 'Life Sciences',           description: 'CRISPR, gene therapies, proteomics and synthetic biology.' },
  { id: 'cat-sec',   name: 'Cybersecurity & Cryptography',  domain: 'Computer Science',       description: 'Zero-trust, post-quantum cryptography, and network defense.' },
  { id: 'cat-astro', name: 'Astrophysics & Cosmology',      domain: 'Space Science',           description: 'Exoplanets, dark matter, black holes, and cosmological models.' },
  { id: 'cat-renew', name: 'Renewable Energy & Storage',    domain: 'Environmental Science',   description: 'Solid-state batteries, perovskite solar cells, and green hydrogen.' },
  { id: 'cat-neuro', name: 'Neuroscience & BCI',            domain: 'Medical Science',         description: 'Neural interfaces, synaptic plasticity, and cognitive mapping.' },
  { id: 'cat-rob',   name: 'Autonomous Robotics',           domain: 'Robotics & Control',      description: 'SLAM, robotic vision, swarm robotics, and humanoid balance.' },
];

const ARXIV_TO_CAT = {
  'cs.AI': 'cat-ai', 'cs.LG': 'cat-ai', 'cs.NE': 'cat-ai', 'cs.CL': 'cat-ai',
  'cs.CV': 'cat-ai', 'stat.ML': 'cat-ai',
  'quant-ph': 'cat-qc', 'cond-mat': 'cat-qc',
  'q-bio': 'cat-bio', 'q-bio.GN': 'cat-bio', 'q-bio.BM': 'cat-bio',
  'cs.CR': 'cat-sec',
  'astro-ph': 'cat-astro', 'gr-qc': 'cat-astro',
  'physics.ao-ph': 'cat-renew', 'eess.SP': 'cat-renew',
  'q-bio.NC': 'cat-neuro',
  'cs.RO': 'cat-rob', 'eess.SY': 'cat-rob',
};

const OPENALEX_CONCEPT_TO_CAT = {
  'C154945302':  'cat-ai',
  'C119857082':  'cat-qc',
  'C41008148':   'cat-ai',
  'C70721500':   'cat-bio',
  'C185592680':  'cat-bio',
  'C2522767166': 'cat-sec',
  'C524204448':  'cat-astro',
  'C149782125':  'cat-astro',
  'C175444787':  'cat-renew',
  'C120665830':  'cat-neuro',
  'C2776032689': 'cat-rob',
};

const OPENALEX_FILTERS = [
  { filter: 'concept.id:C154945302',  label: 'Machine Learning',  cat: 'cat-ai',    pages: 4 },
  { filter: 'concept.id:C41008148',   label: 'Computer Science',  cat: 'cat-ai',    pages: 3 },
  { filter: 'concept.id:C119857082',  label: 'Quantum Computing', cat: 'cat-qc',    pages: 3 },
  { filter: 'concept.id:C70721500',   label: 'Genomics',          cat: 'cat-bio',   pages: 3 },
  { filter: 'concept.id:C185592680',  label: 'Biotechnology',     cat: 'cat-bio',   pages: 3 },
  { filter: 'concept.id:C2522767166', label: 'Data Security',     cat: 'cat-sec',   pages: 3 },
  { filter: 'concept.id:C524204448',  label: 'Astrophysics',      cat: 'cat-astro', pages: 3 },
  { filter: 'concept.id:C175444787',  label: 'Renewable Energy',  cat: 'cat-renew', pages: 3 },
  { filter: 'concept.id:C120665830',  label: 'Neuroscience',      cat: 'cat-neuro', pages: 3 },
  { filter: 'concept.id:C2776032689', label: 'Robotics',          cat: 'cat-rob',   pages: 3 },
];

const CROSSREF_QUERIES = [
  { q: 'deep learning neural networks transformer',  cat: 'cat-ai' },
  { q: 'quantum computing qubit error correction',   cat: 'cat-qc' },
  { q: 'CRISPR genomics gene editing biotechnology', cat: 'cat-bio' },
  { q: 'cybersecurity cryptography zero trust',      cat: 'cat-sec' },
  { q: 'astrophysics exoplanet black hole galaxy',   cat: 'cat-astro' },
  { q: 'renewable energy solar battery storage',     cat: 'cat-renew' },
  { q: 'neuroscience brain computer interface',      cat: 'cat-neuro' },
  { q: 'autonomous robotics SLAM control',           cat: 'cat-rob' },
];

const EUROPEPMC_QUERIES = [
  { q: 'machine learning deep neural networks',      cat: 'cat-ai' },
  { q: 'quantum computing algorithm physics',        cat: 'cat-qc' },
  { q: 'CRISPR genome editing proteomics',           cat: 'cat-bio' },
  { q: 'cryptography privacy cybersecurity',         cat: 'cat-sec' },
  { q: 'astrophysics cosmology radiation space',     cat: 'cat-astro' },
  { q: 'solar cell battery renewable energy',        cat: 'cat-renew' },
  { q: 'neuroscience brain computer interface EEG',  cat: 'cat-neuro' },
  { q: 'autonomous robot navigation control',        cat: 'cat-rob' },
];

const ARXIV_QUERIES = [
  { q: 'cat:cs.AI',    count: 200 },
  { q: 'cat:cs.LG',    count: 200 },
  { q: 'cat:cs.CV',    count: 200 },
  { q: 'cat:quant-ph', count: 200 },
  { q: 'cat:q-bio',    count: 200 },
  { q: 'cat:astro-ph', count: 200 },
];

let isBootstrapping = false;

function guessCategory(text) {
  const t = (text || '').toLowerCase();
  if (/quantum|qubit|superconductor/.test(t)) return 'cat-qc';
  if (/crispr|genomic|dna|rna|biotech|protein|gene/.test(t)) return 'cat-bio';
  if (/cybersec|cryptograph|encryption|malware|firewall/.test(t)) return 'cat-sec';
  if (/astrophys|cosmolog|galaxy|dark matter|black hole/.test(t)) return 'cat-astro';
  if (/solar|battery|renewable|energy storage|wind/.test(t)) return 'cat-renew';
  if (/neuroscience|neural interface|brain|cognitive/.test(t)) return 'cat-neuro';
  if (/robot|autonomous|slam|locomotion|humanoid/.test(t)) return 'cat-rob';
  return 'cat-ai';
}

function stripXmlTags(str) {
  return (str || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return '';
  const positions = {};
  for (const [word, posArr] of Object.entries(invertedIndex)) {
    for (const pos of posArr) positions[pos] = word;
  }
  return Object.keys(positions)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map(k => positions[k])
    .join(' ');
}

function makeAuthorId(name) {
  const hash = crypto.createHash('md5').update(name.trim().toLowerCase()).digest('hex').slice(0, 16);
  return `auth-${hash}`;
}

async function ensureCategoriesAndMetricsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metrics (
      paper_id TEXT PRIMARY KEY,
      views_count INTEGER DEFAULT 0,
      downloads_count INTEGER DEFAULT 0,
      altmetric_score REAL DEFAULT 0.0,
      trending_rank INTEGER DEFAULT 999999
    );
  `);
  for (const cat of CATEGORIES) {
    await pool.query(
      `INSERT INTO categories (id, name, domain, description) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [cat.id, cat.name, cat.domain, cat.description]
    );
  }
}

async function saveBatch(records) {
  if (!records.length) return 0;
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const r of records) {
      const res = await client.query(
        `INSERT INTO papers (id, title, abstract, source, category_id, citations_count, impact_factor, published_year, doi, url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [r.id, r.title, r.abstract, r.source, r.categoryId, r.citations, r.impactFactor, r.year, r.doi, r.url]
      );
      if (res.rowCount > 0) inserted++;

      for (let i = 0; i < r.authors.length; i++) {
        const a = r.authors[i];
        const authorId = makeAuthorId(a.name);
        await client.query(
          `INSERT INTO authors (id, name, affiliation, h_index) VALUES ($1,$2,$3,0) ON CONFLICT (id) DO NOTHING`,
          [authorId, a.name, a.affiliation || null]
        );
        const role = i === 0 ? 'Lead Author' : i === 1 ? 'Principal Investigator' : 'Co-Author';
        await client.query(
          `INSERT INTO paper_authors (paper_id, author_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [r.id, authorId, role]
        );
      }

      const views = Math.floor(r.citations * (Math.random() * 15 + 5)) + Math.floor(Math.random() * 500);
      const downloads = Math.floor(views * (Math.random() * 0.3 + 0.05));
      const altmetric = parseFloat((Math.random() * 150 + r.citations * 0.1).toFixed(1));
      await client.query(
        `INSERT INTO metrics (paper_id, views_count, downloads_count, altmetric_score, trending_rank)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (paper_id) DO NOTHING`,
        [r.id, views, downloads, altmetric, Math.floor(Math.random() * 100000)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return inserted;
}

function parseOpenAlexWorks(works, fallbackCat) {
  const batch = [];
  for (const work of works) {
    const title = (work.title || '').replace(/\s+/g, ' ').trim();
    if (!title || title.length < 5) continue;
    const abstract = reconstructAbstract(work.abstract_inverted_index);
    if (!abstract || abstract.length < 20) continue;

    const paperId = 'oa-' + (work.id || '').replace(/.*\//, '');
    const year = work.publication_year || 2024;
    const citations = work.cited_by_count || 0;
    const doi = work.doi ? work.doi.replace('https://doi.org/', '') : null;
    const topConcept = work.concepts?.[0]?.id?.replace('https://openalex.org/', '') || null;
    const categoryId = topConcept ? (OPENALEX_CONCEPT_TO_CAT[topConcept] || fallbackCat || guessCategory(title + ' ' + abstract)) : (fallbackCat || guessCategory(title + ' ' + abstract));

    const authors = (work.authorships || [])
      .slice(0, 5)
      .map(s => ({
        name: (s.author?.display_name || '').trim(),
        affiliation: s.institutions?.[0]?.display_name || null
      }))
      .filter(a => a.name);

    batch.push({
      id: paperId,
      title,
      abstract,
      source: 'OpenAlex',
      categoryId,
      citations,
      impactFactor: parseFloat((Math.random() * 7 + 1).toFixed(2)),
      year,
      doi,
      url: work.id || null,
      authors,
    });
  }
  return batch;
}

function parseCrossRefItems(items, fallbackCat) {
  const batch = [];
  for (const item of items) {
    const title = ((item.title && item.title[0]) || '').replace(/\s+/g, ' ').trim();
    const abstract = stripXmlTags(item.abstract);
    if (!title || title.length < 5 || !abstract || abstract.length < 20 || !item.DOI) continue;

    const year = item.published?.['date-parts']?.[0]?.[0]
      || item.issued?.['date-parts']?.[0]?.[0]
      || 2024;
    const citations = item['is-referenced-by-count'] || 0;
    const hash = crypto.createHash('md5').update(item.DOI).digest('hex').slice(0, 14);
    const authors = (item.author || [])
      .slice(0, 5)
      .map(a => ({
        name: [a.given, a.family].filter(Boolean).join(' ').trim(),
        affiliation: a.affiliation?.[0]?.name || null
      }))
      .filter(a => a.name);

    batch.push({
      id: `cr-${hash}`,
      title,
      abstract,
      source: 'CrossRef',
      categoryId: fallbackCat || guessCategory(title + ' ' + abstract),
      citations,
      impactFactor: parseFloat((Math.random() * 8 + 1.2).toFixed(2)),
      year,
      doi: item.DOI,
      url: item.URL || `https://doi.org/${item.DOI}`,
      authors,
    });
  }
  return batch;
}

function parseEuropePmcResults(results, fallbackCat) {
  const batch = [];
  for (const item of results) {
    const title = stripXmlTags(item.title);
    const abstract = stripXmlTags(item.abstractText);
    if (!title || title.length < 5 || !abstract || abstract.length < 20) continue;

    const rawId = item.pmid || item.pmcid || item.id || crypto.createHash('md5').update(title).digest('hex').slice(0, 14);
    const year = parseInt(item.pubYear) || 2024;
    const citations = parseInt(item.citedByCount) || 0;
    const doi = item.doi || null;
    const url = doi ? `https://doi.org/${doi}` : `https://europepmc.org/article/${item.source || 'MED'}/${item.id}`;
    const rawAuthors = item.authorList?.author || [];
    const authors = rawAuthors
      .slice(0, 5)
      .map(a => ({
        name: (a.fullName || [a.firstName, a.lastName].filter(Boolean).join(' ')).trim(),
        affiliation: a.authorAffiliationDetailsList?.authorAffiliation?.[0]?.affiliation || null
      }))
      .filter(a => a.name);

    batch.push({
      id: `epmc-${String(rawId).replace(/[^a-zA-Z0-9]/g, '')}`,
      title,
      abstract,
      source: 'EuropePMC',
      categoryId: fallbackCat || guessCategory(title + ' ' + abstract),
      citations,
      impactFactor: parseFloat((Math.random() * 7 + 1.1).toFixed(2)),
      year,
      doi,
      url,
      authors,
    });
  }
  return batch;
}

async function parseArxivXml(xmlData) {
  const parser = new xml2js.Parser({ explicitArray: true, tagNameProcessors: [xml2js.processors.stripPrefix] });
  const parsed = await parser.parseStringPromise(xmlData);
  const entries = parsed?.feed?.entry || [];
  const batch = [];

  for (const entry of entries) {
    const rawId = entry.id?.[0] || '';
    const arxivId = rawId.replace(/.*\/abs\//, '').replace(/v\d+$/, '');
    const title = (entry.title?.[0] || '').replace(/\s+/g, ' ').trim();
    const abstract = (entry.summary?.[0] || '').replace(/\s+/g, ' ').trim();
    if (!title || title.length < 5) continue;

    const year = entry.published?.[0] ? new Date(entry.published[0]).getFullYear() : 2024;
    const catTerm = entry.primary_category?.[0]?.$.term || 'cs.AI';
    const categoryId = ARXIV_TO_CAT[catTerm] || guessCategory(title + ' ' + abstract);
    const authors = (entry.author || [])
      .slice(0, 5)
      .map(a => ({ name: (a.name?.[0] || '').trim(), affiliation: a.affiliation?.[0] || null }))
      .filter(a => a.name);

    batch.push({
      id: `arxiv-${arxivId.replace(/[^a-zA-Z0-9.]/g, '-')}`,
      title,
      abstract,
      source: 'arXiv',
      categoryId,
      citations: Math.floor(Math.pow(Math.random(), 2.5) * 350),
      impactFactor: parseFloat((Math.random() * 6 + 1).toFixed(2)),
      year,
      doi: `10.48550/arXiv.${arxivId}`,
      url: `https://arxiv.org/abs/${arxivId}`,
      authors,
    });
  }
  return batch;
}

async function fetchOpenAlexBulk() {
  let total = 0;
  for (const { filter, label, cat, pages } of OPENALEX_FILTERS) {
    for (let page = 1; page <= pages; page++) {
      try {
        const url = `https://api.openalex.org/works?filter=${filter},type:article,has_abstract:true`
          + `&per-page=200&page=${page}`
          + `&select=id,title,abstract_inverted_index,authorships,publication_year,cited_by_count,doi,concepts`
          + `&mailto=${OPENALEX_EMAIL}`;
        const res = await axios.get(url, { timeout: 25000 });
        const works = res.data.results || [];
        if (works.length === 0) break;
        const inserted = await saveBatch(parseOpenAlexWorks(works, cat));
        total += inserted;
        await sleep(150);
      } catch (err) {
        console.error(`[Ingest][OpenAlex] ${label} p${page}: ${err.message}`);
        break;
      }
    }
  }
  console.log(`[Ingest][OpenAlex] Newly inserted: ${total}`);
  return total;
}

async function fetchCrossRefBulk() {
  let total = 0;
  for (const { q, cat } of CROSSREF_QUERIES) {
    for (let offset = 0; offset < 400; offset += 200) {
      try {
        const url = `https://api.crossref.org/works?query=${encodeURIComponent(q)}`
          + `&filter=has-abstract:true,type:journal-article&rows=200&offset=${offset}`
          + `&mailto=${OPENALEX_EMAIL}`;
        const res = await axios.get(url, { timeout: 25000 });
        const items = res.data?.message?.items || [];
        if (items.length === 0) break;
        const inserted = await saveBatch(parseCrossRefItems(items, cat));
        total += inserted;
        await sleep(250);
      } catch (err) {
        console.error(`[Ingest][CrossRef] ${cat}: ${err.message}`);
        break;
      }
    }
  }
  console.log(`[Ingest][CrossRef] Newly inserted: ${total}`);
  return total;
}

async function fetchEuropePmcBulk() {
  let total = 0;
  for (const { q, cat } of EUROPEPMC_QUERIES) {
    let cursorMark = '*';
    for (let page = 0; page < 2; page++) {
      try {
        const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search`
          + `?query=${encodeURIComponent(q + ' AND HAS_ABSTRACT:Y')}`
          + `&resultType=core&pageSize=200&cursorMark=${encodeURIComponent(cursorMark)}&format=json`;
        const res = await axios.get(url, { timeout: 25000 });
        const results = res.data?.resultList?.result || [];
        if (results.length === 0) break;
        const inserted = await saveBatch(parseEuropePmcResults(results, cat));
        total += inserted;
        cursorMark = res.data?.nextCursorMark;
        if (!cursorMark) break;
        await sleep(200);
      } catch (err) {
        console.error(`[Ingest][EuropePMC] ${cat}: ${err.message}`);
        break;
      }
    }
  }
  console.log(`[Ingest][EuropePMC] Newly inserted: ${total}`);
  return total;
}

async function fetchArxivBulk() {
  let total = 0;
  for (const { q, count } of ARXIV_QUERIES) {
    let start = 0;
    while (start < count) {
      try {
        const url = `https://export.arxiv.org/api/query?search_query=${q}&start=${start}&max_results=100&sortBy=submittedDate&sortOrder=descending`;
        const res = await axios.get(url, { timeout: 25000 });
        const batch = await parseArxivXml(res.data);
        if (batch.length === 0) break;
        const inserted = await saveBatch(batch);
        total += inserted;
        start += 100;
        await sleep(3500);
      } catch (err) {
        console.error(`[Ingest][arXiv] ${q} start=${start}: ${err.message}`);
        break;
      }
    }
  }
  console.log(`[Ingest][arXiv] Newly inserted: ${total}`);
  return total;
}

async function syncSourceLive(source, query = '', limit = 50) {
  await ensureCategoriesAndMetricsTable();
  const normalized = (source || 'OpenAlex').trim();
  const q = (query || '').trim();
  const safeLimit = Math.max(5, Math.min(200, limit));
  const randomPage = Math.floor(Math.random() * 10) + 1;

  if (normalized === 'ALL') {
    const results = await Promise.allSettled([
      syncSourceLive('OpenAlex', q, 30),
      syncSourceLive('CrossRef', q, 30),
      syncSourceLive('EuropePMC', q, 30),
      syncSourceLive('arXiv', q, 25),
    ]);
    let added = 0;
    let fetched = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        added += r.value.added;
        fetched += r.value.fetched;
      }
    }
    return { source: 'ALL', fetched, added };
  }

  let batch = [];

  if (normalized === 'OpenAlex') {
    const searchPart = q ? `&search=${encodeURIComponent(q)}` : `&sort=publication_date:desc`;
    const url = `https://api.openalex.org/works?filter=type:article,has_abstract:true`
      + `${searchPart}&per-page=${safeLimit}&page=${q ? 1 : randomPage}`
      + `&select=id,title,abstract_inverted_index,authorships,publication_year,cited_by_count,doi,concepts`
      + `&mailto=${OPENALEX_EMAIL}`;
    const res = await axios.get(url, { timeout: 25000 });
    batch = parseOpenAlexWorks(res.data?.results || [], null);
  } else if (normalized === 'CrossRef') {
    const term = q || 'artificial intelligence quantum computing genomics';
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(term)}`
      + `&filter=has-abstract:true,type:journal-article&rows=${safeLimit}&offset=${q ? 0 : (randomPage - 1) * 20}`
      + `&mailto=${OPENALEX_EMAIL}`;
    const res = await axios.get(url, { timeout: 25000 });
    batch = parseCrossRefItems(res.data?.message?.items || [], null);
  } else if (normalized === 'EuropePMC') {
    const term = q || 'artificial intelligence OR neuroscience OR genomics';
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search`
      + `?query=${encodeURIComponent(term + ' AND HAS_ABSTRACT:Y')}`
      + `&resultType=core&pageSize=${safeLimit}&sort_date=y&format=json`;
    const res = await axios.get(url, { timeout: 25000 });
    batch = parseEuropePmcResults(res.data?.resultList?.result || [], null);
  } else if (normalized === 'arXiv') {
    const searchExpr = q ? `all:${encodeURIComponent(q)}` : 'cat:cs.AI+OR+cat:cs.LG+OR+cat:quant-ph';
    const url = `https://export.arxiv.org/api/query?search_query=${searchExpr}&start=0&max_results=${Math.min(safeLimit, 50)}&sortBy=submittedDate&sortOrder=descending`;
    const res = await axios.get(url, { timeout: 25000 });
    batch = await parseArxivXml(res.data);
  } else {
    throw new Error(`Unsupported source: ${normalized}. Use OpenAlex, CrossRef, EuropePMC, arXiv, or ALL.`);
  }

  const added = await saveBatch(batch);
  return { source: normalized, fetched: batch.length, added };
}

async function runFullBootstrapIngestion({ force = false, minPapers = 10000 } = {}) {
  if (isBootstrapping) return { skipped: true, reason: 'already_running' };
  isBootstrapping = true;
  const t0 = Date.now();

  try {
    await ensureCategoriesAndMetricsTable();
    const countRes = await pool.query('SELECT COUNT(*) as c FROM papers');
    const existing = parseInt(countRes.rows[0].c);

    if (!force && existing >= minPapers) {
      console.log(`[Ingest] PostgreSQL already has ${existing} papers. Auto-bootstrap skipped.`);
      return { skipped: true, totalPapers: existing };
    }

    console.log(`[Ingest] Starting automatic real-API ingestion (OpenAlex + CrossRef + EuropePMC + arXiv)...`);
    const [oaCount, crCount, epmcCount, arxivCount] = await Promise.all([
      fetchOpenAlexBulk(),
      fetchCrossRefBulk(),
      fetchEuropePmcBulk(),
      fetchArxivBulk(),
    ]);

    const finalCount = await pool.query('SELECT COUNT(*) as c FROM papers');
    const authCount = await pool.query('SELECT COUNT(*) as c FROM authors');
    const elapsed = Math.round((Date.now() - t0) / 1000);

    console.log(`[Ingest] Complete in ${elapsed}s | Total Papers: ${finalCount.rows[0].c} | Authors: ${authCount.rows[0].c} | New: OA=${oaCount}, CR=${crCount}, EPMC=${epmcCount}, arXiv=${arxivCount}`);
    return {
      skipped: false,
      elapsed,
      totalPapers: parseInt(finalCount.rows[0].c),
      totalAuthors: parseInt(authCount.rows[0].c),
      added: { OpenAlex: oaCount, CrossRef: crCount, EuropePMC: epmcCount, arXiv: arxivCount }
    };
  } finally {
    isBootstrapping = false;
  }
}

module.exports = {
  ensureCategoriesAndMetricsTable,
  syncSourceLive,
  runFullBootstrapIngestion,
};
