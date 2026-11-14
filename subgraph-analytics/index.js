const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const { buildSubgraphSchema } = require('@apollo/subgraph');
const gql = require('graphql-tag');
const client = require('prom-client');
const db = require('./db');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'subgraph_analytics_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds in Analytics Subgraph',
  labelNames: ['operationName', 'status'],
  registers: [register]
});

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

const resolvers = {
  Paper: {
    reviews(parent) {
      return db.prepare('SELECT id, paper_id as paperId, reviewer_name as reviewerName, rating, comment, created_at as createdAt FROM reviews WHERE paper_id = ? ORDER BY created_at DESC').all(parent.id);
    },
    metrics(parent) {
      let row = db.prepare('SELECT views_count as viewsCount, downloads_count as downloadsCount, altmetric_score as altmetricScore, trending_rank as trendingRank FROM metrics WHERE paper_id = ?').get(parent.id);
      if (!row) {
        row = { viewsCount: 1, downloadsCount: 0, altmetricScore: 0.0, trendingRank: 999999 };
      }
      const ratingRes = db.prepare('SELECT AVG(rating) as avgRating FROM reviews WHERE paper_id = ?').get(parent.id);
      return {
        paperId: parent.id,
        ...row,
        averageRating: ratingRes.avgRating ? parseFloat(ratingRes.avgRating.toFixed(2)) : null
      };
    },
    isBookmarked(parent) {
      const b = db.prepare('SELECT id FROM bookmarks WHERE paper_id = ?').get(parent.id);
      return !!b;
    }
  },

  Query: {
    paperReviews(_, { paperId }) {
      return db.prepare('SELECT id, paper_id as paperId, reviewer_name as reviewerName, rating, comment, created_at as createdAt FROM reviews WHERE paper_id = ?').all(paperId);
    },

    paperMetrics(_, { paperId }) {
      const row = db.prepare('SELECT views_count as viewsCount, downloads_count as downloadsCount, altmetric_score as altmetricScore, trending_rank as trendingRank FROM metrics WHERE paper_id = ?').get(paperId);
      if (!row) return null;
      const ratingRes = db.prepare('SELECT AVG(rating) as avgRating FROM reviews WHERE paper_id = ?').get(paperId);
      return {
        paperId,
        ...row,
        averageRating: ratingRes.avgRating ? parseFloat(ratingRes.avgRating.toFixed(2)) : null
      };
    },

    analyticsSummary() {
      const stats = db.prepare(`
        SELECT 
          SUM(views_count) as totalViews,
          SUM(downloads_count) as totalDownloads
        FROM metrics
      `).get();

      const revStats = db.prepare('SELECT COUNT(*) as totalRev, AVG(rating) as avgRate FROM reviews').get();

      const topPapers = db.prepare(`
        SELECT paper_id as paperId, views_count as viewsCount, downloads_count as downloadsCount, altmetric_score as altmetricScore
        FROM metrics
        ORDER BY views_count DESC
        LIMIT 5
      `).all();

      return {
        totalViews: stats.totalViews || 0,
        totalDownloads: stats.totalDownloads || 0,
        totalReviews: revStats.totalRev || 0,
        averageSystemRating: revStats.avgRate ? parseFloat(revStats.avgRate.toFixed(2)) : 0,
        topRatedPapers: topPapers
      };
    },

    bookmarks() {
      return db.prepare('SELECT id, paper_id as paperId, tag, created_at as createdAt FROM bookmarks ORDER BY created_at DESC').all();
    }
  },

  Mutation: {
    addReview(_, { input }) {
      const id = `rev-${Date.now()}`;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO reviews (id, paper_id, reviewer_name, rating, comment, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, input.paperId, input.reviewerName, input.rating, input.comment || '', now);

      return {
        id,
        paperId: input.paperId,
        reviewerName: input.reviewerName,
        rating: input.rating,
        comment: input.comment,
        createdAt: now
      };
    },

    recordView(_, { paperId }) {
      const row = db.prepare('SELECT * FROM metrics WHERE paper_id = ?').get(paperId);
      if (row) {
        db.prepare('UPDATE metrics SET views_count = views_count + 1 WHERE paper_id = ?').run(paperId);
      } else {
        db.prepare('INSERT INTO metrics (paper_id, views_count, downloads_count, altmetric_score, trending_rank) VALUES (?, 1, 0, 1.0, 999999)').run(paperId);
      }

      const updated = db.prepare('SELECT views_count as viewsCount, downloads_count as downloadsCount, altmetric_score as altmetricScore, trending_rank as trendingRank FROM metrics WHERE paper_id = ?').get(paperId);
      return {
        paperId,
        ...updated,
        averageRating: 4.5
      };
    },

    toggleBookmark(_, { paperId, tag = 'General' }) {
      const existing = db.prepare('SELECT id FROM bookmarks WHERE paper_id = ?').get(paperId);
      if (existing) {
        db.prepare('DELETE FROM bookmarks WHERE id = ?').run(existing.id);
        return { success: true, message: `Removed bookmark for ${paperId}` };
      } else {
        const id = `bm-${Date.now()}`;
        db.prepare('INSERT INTO bookmarks (id, paper_id, tag) VALUES (?, ?, ?)').run(id, paperId, tag);
        return { success: true, message: `Added bookmark for ${paperId}` };
      }
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

const PORT = 4002;

startStandaloneServer(server, {
  listen: { port: PORT }
}).then(({ url }) => {
  console.log(`[Analytics Subgraph] Ready at ${url}`);
});
