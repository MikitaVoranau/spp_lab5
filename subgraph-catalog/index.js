const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const { buildSubgraphSchema } = require('@apollo/subgraph');
const gql = require('graphql-tag');
const client = require('prom-client');
const { pool, initCatalogSchema, mapPaper } = require('./db');
const {
  ensureCategoriesAndMetricsTable,
  syncSourceLive,
  runFullBootstrapIngestion
} = require('./ingestService');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'subgraph_catalog_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds in Catalog Subgraph',
  labelNames: ['operationName', 'status'],
  registers: [register]
});

const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.0",
          import: ["@key", "@shareable"])

  type Category {
    id: ID!
    name: String!
    domain: String!
    description: String
    papersCount: Int!
  }

  type Author {
    id: ID!
    name: String!
    affiliation: String
    hIndex: Int
    email: String
    country: String
    papers: [Paper!]!
  }

  type PaperAuthorRel {
    author: Author!
    role: String
  }

  type Paper @key(fields: "id") {
    id: ID!
    title: String!
    abstract: String
    source: String!
    categoryId: String
    category: Category
    authors: [PaperAuthorRel!]!
    citationsCount: Int!
    impactFactor: Float!
    publishedYear: Int!
    doi: String
    url: String
  }

  type PaperConnection {
    items: [Paper!]!
    totalCount: Int!
    page: Int!
    pageSize: Int!
    totalPages: Int!
  }

  input PaperFilterInput {
    source: String
    categoryId: String
    yearFrom: Int
    yearTo: Int
    minCitations: Int
    search: String
  }

  enum SortOrder { ASC DESC }

  enum PaperSortField {
    citationsCount
    publishedYear
    impactFactor
    title
  }

  input PaperSortInput {
    field: PaperSortField!
    order: SortOrder!
  }

  input CreatePaperInput {
    title: String!
    abstract: String
    source: String!
    categoryId: String!
    publishedYear: Int!
    authorIds: [String!]
  }

  type CatalogMutationResponse {
    success: Boolean!
    message: String!
    paper: Paper
  }

  type CatalogStats {
    totalPapers: Int!
    totalAuthors: Int!
    totalCategories: Int!
    sources: [SourceCount!]!
  }

  type SourceCount {
    source: String!
    count: Int!
  }

  type Query {
    papers(
      filter: PaperFilterInput
      sort: PaperSortInput
      page: Int
      pageSize: Int
    ): PaperConnection!
    paper(id: ID!): Paper
    categories: [Category!]!
    category(id: ID!): Category
    authors(search: String, limit: Int): [Author!]!
    author(id: ID!): Author
    catalogStats: CatalogStats!
  }

  type Mutation {
    createPaper(input: CreatePaperInput!): CatalogMutationResponse!
    deletePaper(id: ID!): CatalogMutationResponse!
    syncExternalData(source: String!, query: String): CatalogMutationResponse!
  }
`;

const resolvers = {
  Paper: {
    async __resolveReference(ref) {
      const { rows } = await pool.query('SELECT * FROM papers WHERE id = $1', [ref.id]);
      return rows[0] ? mapPaper(rows[0]) : null;
    },
    async category(parent) {
      if (!parent.categoryId) return null;
      const { rows } = await pool.query('SELECT * FROM categories WHERE id = $1', [parent.categoryId]);
      return rows[0] || null;
    },
    async authors(parent) {
      const { rows } = await pool.query(`
        SELECT a.id, a.name, a.affiliation, a.h_index, a.email, a.country, pa.role
        FROM authors a
        JOIN paper_authors pa ON a.id = pa.author_id
        WHERE pa.paper_id = $1
      `, [parent.id]);
      return rows.map(r => ({
        role: r.role,
        author: { id: r.id, name: r.name, affiliation: r.affiliation, hIndex: r.h_index, email: r.email, country: r.country }
      }));
    }
  },

  Category: {
    async papersCount(parent) {
      const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM papers WHERE category_id = $1', [parent.id]);
      return parseInt(rows[0].cnt);
    }
  },

  Author: {
    async papers(parent) {
      const { rows } = await pool.query(`
        SELECT p.* FROM papers p
        JOIN paper_authors pa ON p.id = pa.paper_id
        WHERE pa.author_id = $1 LIMIT 20
      `, [parent.id]);
      return rows.map(mapPaper);
    }
  },

  Query: {
    async paper(_, { id }) {
      const { rows } = await pool.query('SELECT * FROM papers WHERE id = $1', [id]);
      return rows[0] ? mapPaper(rows[0]) : null;
    },

    async papers(_, { filter = {}, sort, page = 1, pageSize = 10 }) {
      const conditions = [];
      const params = [];
      let idx = 1;

      if (filter.source) {
        conditions.push(`source = $${idx++}`);
        params.push(filter.source);
      }
      if (filter.categoryId) {
        conditions.push(`category_id = $${idx++}`);
        params.push(filter.categoryId);
      }
      if (filter.yearFrom) {
        conditions.push(`published_year >= $${idx++}`);
        params.push(filter.yearFrom);
      }
      if (filter.yearTo) {
        conditions.push(`published_year <= $${idx++}`);
        params.push(filter.yearTo);
      }
      if (filter.minCitations) {
        conditions.push(`citations_count >= $${idx++}`);
        params.push(filter.minCitations);
      }
      if (filter.search && filter.search.trim()) {
        conditions.push(`(title ILIKE $${idx} OR abstract ILIKE $${idx + 1})`);
        const s = `%${filter.search.trim()}%`;
        params.push(s, s);
        idx += 2;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await pool.query(`SELECT COUNT(*) as total FROM papers ${where}`, params);
      const totalCount = parseInt(countRes.rows[0].total);

      const fieldMap = {
        citationsCount: 'citations_count',
        publishedYear: 'published_year',
        impactFactor: 'impact_factor',
        title: 'title'
      };
      const col = fieldMap[sort?.field] || 'published_year';
      const dir = sort?.order === 'ASC' ? 'ASC' : 'DESC';

      const limit = Math.max(1, Math.min(100, pageSize));
      const offset = (Math.max(1, page) - 1) * limit;

      const dataRes = await pool.query(
        `SELECT * FROM papers ${where} ORDER BY ${col} ${dir} LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      );

      return {
        items: dataRes.rows.map(mapPaper),
        totalCount,
        page,
        pageSize: limit,
        totalPages: Math.ceil(totalCount / limit) || 1
      };
    },

    async categories() {
      const { rows } = await pool.query('SELECT * FROM categories ORDER BY name');
      return rows;
    },

    async category(_, { id }) {
      const { rows } = await pool.query('SELECT * FROM categories WHERE id = $1', [id]);
      return rows[0] || null;
    },

    async authors(_, { search, limit = 20 }) {
      if (search && search.trim()) {
        const { rows } = await pool.query(
          'SELECT * FROM authors WHERE name ILIKE $1 LIMIT $2',
          [`%${search.trim()}%`, limit]
        );
        return rows.map(r => ({ ...r, hIndex: r.h_index }));
      }
      const { rows } = await pool.query('SELECT * FROM authors LIMIT $1', [limit]);
      return rows.map(r => ({ ...r, hIndex: r.h_index }));
    },

    async author(_, { id }) {
      const { rows } = await pool.query('SELECT * FROM authors WHERE id = $1', [id]);
      if (!rows[0]) return null;
      return { ...rows[0], hIndex: rows[0].h_index };
    },

    async catalogStats() {
      const [papersRes, authorsRes, catsRes, sourcesRes] = await Promise.all([
        pool.query('SELECT COUNT(*) as c FROM papers'),
        pool.query('SELECT COUNT(*) as c FROM authors'),
        pool.query('SELECT COUNT(*) as c FROM categories'),
        pool.query('SELECT source, COUNT(*) as count FROM papers GROUP BY source ORDER BY count DESC'),
      ]);
      return {
        totalPapers: parseInt(papersRes.rows[0].c),
        totalAuthors: parseInt(authorsRes.rows[0].c),
        totalCategories: parseInt(catsRes.rows[0].c),
        sources: sourcesRes.rows.map(r => ({ source: r.source, count: parseInt(r.count) }))
      };
    }
  },

  Mutation: {
    async createPaper(_, { input }) {
      const id = `paper-manual-${Date.now()}`;
      const doi = `10.1016/manual.${new Date().getFullYear()}.${Date.now().toString().slice(-6)}`;
      const url = `https://${input.source.toLowerCase()}.org/abs/${Date.now().toString().slice(-6)}`;

      await pool.query(
        `INSERT INTO papers (id, title, abstract, source, category_id, published_year, doi, url, citations_count, impact_factor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,1.0)`,
        [id, input.title, input.abstract || '', input.source, input.categoryId, input.publishedYear, doi, url]
      );

      if (input.authorIds && input.authorIds.length > 0) {
        for (const aid of input.authorIds) {
          try {
            await pool.query(
              'INSERT INTO paper_authors (paper_id, author_id, role) VALUES ($1,$2,$3)',
              [id, aid, 'Lead Author']
            );
          } catch (_) {}
        }
      }

      const { rows } = await pool.query('SELECT * FROM papers WHERE id = $1', [id]);
      return { success: true, message: 'Paper created successfully.', paper: mapPaper(rows[0]) };
    },

    async deletePaper(_, { id }) {
      const { rows } = await pool.query('SELECT id FROM papers WHERE id = $1', [id]);
      if (!rows[0]) return { success: false, message: 'Paper not found.', paper: null };
      await pool.query('DELETE FROM papers WHERE id = $1', [id]);
      return { success: true, message: `Paper ${id} deleted.`, paper: null };
    },

    async syncExternalData(_, { source, query }) {
      try {
        const result = await syncSourceLive(source, query || '', 40);
        return {
          success: true,
          message: `Synced ${result.source}: fetched ${result.fetched} real papers, added ${result.added} new to PostgreSQL.`,
          paper: null
        };
      } catch (err) {
        return {
          success: false,
          message: `Sync failed for ${source}: ${err.message}`,
          paper: null
        };
      }
    }
  }
};

async function main() {
  await initCatalogSchema();
  await ensureCategoriesAndMetricsTable();

  const { rows } = await pool.query('SELECT COUNT(*) as c FROM papers');
  const existing = parseInt(rows[0].c);
  if (existing < 100) {
    console.log(`[Catalog Subgraph] Database has ${existing} papers. Launching automatic background API ingestion...`);
    runFullBootstrapIngestion({ minPapers: 10000 }).catch(err => {
      console.error('[Catalog Auto-Ingest] Error:', err.message);
    });
  } else {
    console.log(`[Catalog Subgraph] PostgreSQL ready with ${existing} papers.`);
  }

  const server = new ApolloServer({
    schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
    plugins: [{
      async requestDidStart(requestContext) {
        const start = process.hrtime();
        const opName = requestContext.request.operationName || 'AnonymousOp';
        return {
          async willSendResponse() {
            const delta = process.hrtime(start);
            httpRequestDuration.labels(opName, '200').observe(delta[0] + delta[1] / 1e9);
          }
        };
      }
    }]
  });

  const { url } = await startStandaloneServer(server, { listen: { port: 4001 } });
  console.log(`[Catalog Subgraph] Ready at ${url}`);
}

main().catch(err => { console.error('[Catalog] Fatal:', err); process.exit(1); });
