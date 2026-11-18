require('dotenv').config();
const { pool: catalogPool, initCatalogSchema } = require('../subgraph-catalog/db');
const { pool: analyticsPool, initAnalyticsSchema } = require('../subgraph-analytics/db');
const { runFullBootstrapIngestion } = require('../subgraph-catalog/ingestService');

async function main() {
  const force = process.argv.includes('--force');
  await initCatalogSchema();
  await initAnalyticsSchema();
  await runFullBootstrapIngestion({ force });
  await catalogPool.end();
  await analyticsPool.end();
}

main().catch(err => {
  console.error('[Ingest Fatal]', err);
  process.exit(1);
});
