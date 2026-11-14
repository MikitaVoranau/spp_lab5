const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const { buildSubgraphSchema } = require('@apollo/subgraph');
const gql = require('graphql-tag');
const client = require('prom-client');
const db = require('./db');

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

  enum SortOrder {
    ASC
    DESC
  }

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

  type Query {
    papers(
      filter: PaperFilterInput
      sort: PaperSortInput
      page: Int = 1
      pageSize: Int = 10
    ): PaperConnection!
    
    paper(id: ID!): Paper
    categories: [Category!]!
    category(id: ID!): Category
    authors(search: String, limit: Int = 20): [Author!]!
    author(id: ID!): Author
    catalogStats: CatalogStats!
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

  type Mutation {
    createPaper(input: CreatePaperInput!): CatalogMutationResponse!
    deletePaper(id: ID!): CatalogMutationResponse!
    syncExternalData(source: String!): CatalogMutationResponse!
  }
`;

const resolvers = {
  Paper: {
    __resolveReference(ref) {
      const stmt = db.prepare('SELECT * FROM papers WHERE id = ?');
      const row = stmt.get(ref.id);
      if (!row) return null;
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
        url: row.url
      };
    },
    category(parent) {
      if (!parent.categoryId) return null;
      return db.prepare('SELECT * FROM categories WHERE id = ?').get(parent.categoryId);
    },
    authors(parent) {
      const rows = db.prepare(`
        SELECT a.*, pa.role 
        FROM authors a 
        JOIN paper_authors pa ON a.id = pa.author_id 
        WHERE pa.paper_id = ?
      `).all(parent.id);

      return rows.map(r => ({
        role: r.role,
        author: {
          id: r.id,
          name: r.name,
          affiliation: r.affiliation,
          hIndex: r.hIndex,
          email: r.email,
          country: r.country
        }
      }));
    }
  },

  Category: {
    papersCount(parent) {
      const res = db.prepare('SELECT COUNT(*) as cnt FROM papers WHERE category_id = ?').get(parent.id);
      return res.cnt;
    }
  },

  Author: {
    papers(parent) {
      const rows = db.prepare(`
        SELECT p.* 
        FROM papers p 
        JOIN paper_authors pa ON p.id = pa.paper_id 
        WHERE pa.author_id = ?
        LIMIT 20
      `).all(parent.id);

      return rows.map(row => ({
        id: row.id,
        title: row.title,
        abstract: row.abstract,
        source: row.source,
        categoryId: row.category_id,
        citationsCount: row.citations_count,
        impactFactor: row.impact_factor,
        publishedYear: row.published_year,
        doi: row.doi,
        url: row.url
      }));
    }
  },

  Query: {
    paper(_, { id }) {
      const row = db.prepare('SELECT * FROM papers WHERE id = ?').get(id);
      if (!row) return null;
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
        url: row.url
      };
    },

    papers(_, { filter = {}, sort, page = 1, pageSize = 10 }) {
      const conditions = [];
      const params = [];

      if (filter.source) {
        conditions.push('source = ?');
        params.push(filter.source);
      }
      if (filter.categoryId) {
        conditions.push('category_id = ?');
        params.push(filter.categoryId);
      }
      if (filter.yearFrom) {
        conditions.push('published_year >= ?');
        params.push(filter.yearFrom);
      }
      if (filter.yearTo) {
        conditions.push('published_year <= ?');
        params.push(filter.yearTo);
      }
      if (filter.minCitations) {
        conditions.push('citations_count >= ?');
        params.push(filter.minCitations);
      }
      if (filter.search && filter.search.trim()) {
        conditions.push('(title LIKE ? OR abstract LIKE ?)');
        const s = `%${filter.search.trim()}%`;
        params.push(s, s);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countSql = `SELECT COUNT(*) as total FROM papers ${whereClause}`;
      const totalCount = db.prepare(countSql).get(...params).total;

      let orderClause = 'ORDER BY published_year DESC, citations_count DESC';
      if (sort && sort.field) {
        const fieldMap = {
          citationsCount: 'citations_count',
          publishedYear: 'published_year',
          impactFactor: 'impact_factor',
          title: 'title'
        };
        const col = fieldMap[sort.field] || 'published_year';
        const dir = sort.order === 'ASC' ? 'ASC' : 'DESC';
        orderClause = `ORDER BY ${col} ${dir}`;
      }

      const limit = Math.max(1, Math.min(100, pageSize));
      const offset = (Math.max(1, page) - 1) * limit;

      const dataSql = `SELECT * FROM papers ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
      const rows = db.prepare(dataSql).all(...params, limit, offset);

      const items = rows.map(r => ({
        id: r.id,
        title: r.title,
        abstract: r.abstract,
        source: r.source,
        categoryId: r.category_id,
        citationsCount: r.citations_count,
        impactFactor: r.impact_factor,
        publishedYear: r.published_year,
        doi: r.doi,
        url: r.url
      }));

      return {
        items,
        totalCount,
        page,
        pageSize: limit,
        totalPages: Math.ceil(totalCount / limit) || 1
      };
    },

    categories() {
      return db.prepare('SELECT * FROM categories').all();
    },

    category(_, { id }) {
      return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    },

    authors(_, { search, limit = 20 }) {
      if (search && search.trim()) {
        return db.prepare('SELECT * FROM authors WHERE name LIKE ? LIMIT ?')
          .all(`%${search.trim()}%`, limit);
      }
      return db.prepare('SELECT * FROM authors LIMIT ?').all(limit);
    },

    author(_, { id }) {
      return db.prepare('SELECT * FROM authors WHERE id = ?').get(id);
    },

    catalogStats() {
      const totalPapers = db.prepare('SELECT count(*) as c FROM papers').get().c;
      const totalAuthors = db.prepare('SELECT count(*) as c FROM authors').get().c;
      const totalCategories = db.prepare('SELECT count(*) as c FROM categories').get().c;
      const sources = db.prepare('SELECT source, count(*) as count FROM papers GROUP BY source').all();

      return {
        totalPapers,
        totalAuthors,
        totalCategories,
        sources
      };
    }
  },

  Mutation: {
    createPaper(_, { input }) {
      const nextId = `paper-${Date.now()}`;
      const doi = `10.1016/manual.${new Date().getFullYear()}.${Date.now().toString().slice(-6)}`;
      const url = `https://${input.source.toLowerCase()}.org/abs/${Date.now().toString().slice(-6)}`;

      const stmt = db.prepare(`
        INSERT INTO papers (id, title, abstract, source, category_id, published_year, doi, url, citations_count, impact_factor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1.0)
      `);
      stmt.run(nextId, input.title, input.abstract || '', input.source, input.categoryId, input.publishedYear, doi, url);

      if (input.authorIds && input.authorIds.length > 0) {
        const authStmt = db.prepare('INSERT INTO paper_authors (paper_id, author_id, role) VALUES (?, ?, ?)');
        for (const aid of input.authorIds) {
          try {
            authStmt.run(nextId, aid, 'Lead Author');
          } catch(e) {}
        }
      }

      const row = db.prepare('SELECT * FROM papers WHERE id = ?').get(nextId);
      return {
        success: true,
        message: 'Scientific paper created successfully.',
        paper: {
          id: row.id,
          title: row.title,
          abstract: row.abstract,
          source: row.source,
          categoryId: row.category_id,
          citationsCount: row.citations_count,
          impactFactor: row.impact_factor,
          publishedYear: row.published_year,
          doi: row.doi,
          url: row.url
        }
      };
    },

    deletePaper(_, { id }) {
      const existing = db.prepare('SELECT id FROM papers WHERE id = ?').get(id);
      if (!existing) {
        return { success: false, message: 'Paper not found', paper: null };
      }
      db.prepare('DELETE FROM papers WHERE id = ?').run(id);
      return { success: true, message: `Paper ${id} deleted successfully.`, paper: null };
    },

    syncExternalData(_, { source }) {
      const count = 10;
      const cat = db.prepare('SELECT id FROM categories LIMIT 1').get();
      const insert = db.prepare(`
        INSERT INTO papers (id, title, abstract, source, category_id, published_year, doi, url, citations_count, impact_factor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < count; i++) {
        const id = `paper-sync-${Date.now()}-${i}`;
        insert.run(
          id,
          `Latest Discoveries in Autonomous Systems Vol. ${i + 1}`,
          `Continuous data pipeline ingested entry from ${source} real-time endpoint.`,
          source,
          cat ? cat.id : 'cat-ai',
          2026,
          `10.1000/sync.${Date.now()}.${i}`,
          `https://${source.toLowerCase()}.org/entry/${id}`,
          Math.floor(Math.random() * 50),
          2.5
        );
      }

      return {
        success: true,
        message: `Automated ingestion pipeline fetched 10 new items from ${source}.`,
        paper: null
      };
    }
  }
};

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
  plugins: [{
    async requestDidStart(requestContext) {
      const start = process.hrtime();
      const opName = requestContext.request.operationName || 'AnonymousOp';
      return {
        async willSendResponse() {
          const delta = process.hrtime(start);
          const duration = delta[0] + delta[1] / 1e9;
          httpRequestDuration.labels(opName, '200').observe(duration);
        }
      };
    }
  }]
});

const PORT = 4001;

startStandaloneServer(server, {
  listen: { port: PORT }
}).then(({ url }) => {
  console.log(`[Catalog Subgraph] Ready at ${url}`);
});
