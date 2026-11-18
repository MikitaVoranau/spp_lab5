const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const { buildSubgraphSchema } = require('@apollo/subgraph');
const gql = require('graphql-tag');
const { pool, initAnalyticsSchema } = require('./db');

const typeDefs = gql`
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.0",
          import: ["@key", "@shareable"])

  type Review {
    id: ID!
    paperId: ID!
    reviewerName: String!
    rating: Int!
    comment: String
    createdAt: String!
  }

  type PaperMetrics {
    paperId: ID!
    viewsCount: Int!
    downloadsCount: Int!
    altmetricScore: Float!
    trendingRank: Int!
    averageRating: Float
  }

  type Bookmark {
    id: ID!
    paperId: ID!
    tag: String!
    createdAt: String!
  }

  extend type Paper @key(fields: "id") {
    id: ID!
    reviews: [Review!]!
    metrics: PaperMetrics
    isBookmarked: Boolean!
  }

  type AnalyticsSummary {
    totalViews: Int!
    totalDownloads: Int!
    totalReviews: Int!
    averageSystemRating: Float!
    topRatedPapers: [TopPaperItem!]!
  }

  type TopPaperItem {
    paperId: ID!
    viewsCount: Int!
    downloadsCount: Int!
    altmetricScore: Float!
  }

  type AnalyticsMutationResponse {
    success: Boolean!
    message: String!
  }

  input AddReviewInput {
    paperId: ID!
    reviewerName: String!
    rating: Int!
    comment: String
  }

  type Query {
    paperReviews(paperId: ID!): [Review!]!
    paperMetrics(paperId: ID!): PaperMetrics
    analyticsSummary: AnalyticsSummary!
    bookmarks: [Bookmark!]!
  }

  type Mutation {
    addReview(input: AddReviewInput!): Review!
    recordView(paperId: ID!): PaperMetrics!
    toggleBookmark(paperId: ID!, tag: String): AnalyticsMutationResponse!
  }
`;

function mapReview(r) {
  return {
    id: r.id,
    paperId: r.paper_id,
    reviewerName: r.reviewer_name,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at
  };
}

function mapMetrics(paperId, r, avgRating) {
  return {
    paperId,
    viewsCount: r.views_count,
    downloadsCount: r.downloads_count,
    altmetricScore: r.altmetric_score,
    trendingRank: r.trending_rank,
    averageRating: avgRating != null ? parseFloat(parseFloat(avgRating).toFixed(2)) : null
  };
}

const resolvers = {
  Paper: {
    async __resolveReference(ref) {
      return { id: ref.id };
    },
    async reviews(parent) {
      const { rows } = await pool.query(
        'SELECT * FROM reviews WHERE paper_id = $1 ORDER BY created_at DESC', [parent.id]
      );
      return rows.map(mapReview);
    },
    async metrics(parent) {
      const { rows } = await pool.query('SELECT * FROM metrics WHERE paper_id = $1', [parent.id]);
      const ratingRes = await pool.query(
        'SELECT AVG(rating) as avg FROM reviews WHERE paper_id = $1', [parent.id]
      );
      const row = rows[0] || { views_count: 1, downloads_count: 0, altmetric_score: 0.0, trending_rank: 999999 };
      return mapMetrics(parent.id, row, ratingRes.rows[0]?.avg);
    },
    async isBookmarked(parent) {
      const { rows } = await pool.query('SELECT id FROM bookmarks WHERE paper_id = $1', [parent.id]);
      return rows.length > 0;
    }
  },

  Query: {
    async paperReviews(_, { paperId }) {
      const { rows } = await pool.query('SELECT * FROM reviews WHERE paper_id = $1', [paperId]);
      return rows.map(mapReview);
    },
    async paperMetrics(_, { paperId }) {
      const { rows } = await pool.query('SELECT * FROM metrics WHERE paper_id = $1', [paperId]);
      if (!rows[0]) return null;
      const ratingRes = await pool.query('SELECT AVG(rating) as avg FROM reviews WHERE paper_id = $1', [paperId]);
      return mapMetrics(paperId, rows[0], ratingRes.rows[0]?.avg);
    },
    async analyticsSummary() {
      const [stats, revStats, top] = await Promise.all([
        pool.query('SELECT SUM(views_count) as tv, SUM(downloads_count) as td FROM metrics'),
        pool.query('SELECT COUNT(*) as cnt, AVG(rating) as avg FROM reviews'),
        pool.query('SELECT paper_id, views_count, downloads_count, altmetric_score FROM metrics ORDER BY views_count DESC LIMIT 5')
      ]);
      return {
        totalViews: parseInt(stats.rows[0].tv) || 0,
        totalDownloads: parseInt(stats.rows[0].td) || 0,
        totalReviews: parseInt(revStats.rows[0].cnt) || 0,
        averageSystemRating: revStats.rows[0].avg ? parseFloat(parseFloat(revStats.rows[0].avg).toFixed(2)) : 0,
        topRatedPapers: top.rows.map(r => ({
          paperId: r.paper_id,
          viewsCount: r.views_count,
          downloadsCount: r.downloads_count,
          altmetricScore: r.altmetric_score
        }))
      };
    },
    async bookmarks() {
      const { rows } = await pool.query('SELECT * FROM bookmarks ORDER BY created_at DESC');
      return rows.map(r => ({
        id: r.id,
        paperId: r.paper_id,
        tag: r.tag,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at
      }));
    }
  },

  Mutation: {
    async addReview(_, { input }) {
      const id = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date();
      await pool.query(
        'INSERT INTO reviews (id, paper_id, reviewer_name, rating, comment, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, input.paperId, input.reviewerName, input.rating, input.comment || '', now]
      );
      return {
        id, paperId: input.paperId, reviewerName: input.reviewerName,
        rating: input.rating, comment: input.comment, createdAt: now.toISOString()
      };
    },
    async recordView(_, { paperId }) {
      const { rows } = await pool.query('SELECT * FROM metrics WHERE paper_id = $1', [paperId]);
      if (rows[0]) {
        await pool.query('UPDATE metrics SET views_count = views_count + 1 WHERE paper_id = $1', [paperId]);
      } else {
        await pool.query(
          'INSERT INTO metrics (paper_id, views_count, downloads_count, altmetric_score, trending_rank) VALUES ($1,1,0,1.0,999999)',
          [paperId]
        );
      }
      const { rows: updated } = await pool.query('SELECT * FROM metrics WHERE paper_id = $1', [paperId]);
      return mapMetrics(paperId, updated[0], null);
    },
    async toggleBookmark(_, { paperId, tag = 'General' }) {
      const { rows } = await pool.query('SELECT id FROM bookmarks WHERE paper_id = $1', [paperId]);
      if (rows[0]) {
        await pool.query('DELETE FROM bookmarks WHERE id = $1', [rows[0].id]);
        return { success: true, message: `Removed bookmark for ${paperId}` };
      } else {
        const id = `bm-${Date.now()}`;
        await pool.query('INSERT INTO bookmarks (id, paper_id, tag) VALUES ($1,$2,$3)', [id, paperId, tag]);
        return { success: true, message: `Added bookmark for ${paperId}` };
      }
    }
  }
};

async function main() {
  await initAnalyticsSchema();

  const server = new ApolloServer({
    schema: buildSubgraphSchema([{ typeDefs, resolvers }])
  });

  const { url } = await startStandaloneServer(server, { listen: { port: 4002 } });
  console.log(`[Analytics Subgraph] Ready at ${url}`);
}

main().catch(err => { console.error('[Analytics] Fatal:', err); process.exit(1); });
