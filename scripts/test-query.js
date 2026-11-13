const axios = require('axios');

async function testFederation() {
  const query = `
    query TestFederatedQuery {
      papers(pageSize: 2) {
        totalCount
        page
        items {
          id
          title
          source
          publishedYear
          category {
            name
            domain
          }
          authors {
            role
            author {
              name
              affiliation
            }
          }
          metrics {
            viewsCount
            downloadsCount
            altmetricScore
            averageRating
          }
          reviews {
            reviewerName
            rating
            comment
          }
        }
      }
    }
  `;

  try {
    const res = await axios.post('http://localhost:4000/graphql', { query });
    console.log('STATUS:', res.status);
    console.log('FEDERATED GRAPHQL RESPONSE:');
    console.log(JSON.stringify(res.data, null, 2));

    // Also test metrics endpoint
    const metricsRes = await axios.get('http://localhost:4000/metrics');
    console.log('\nPROMETHEUS METRICS PREVIEW (First 5 lines):');
    console.log(metricsRes.data.split('\n').slice(0, 5).join('\n'));
  } catch (err) {
    console.error('Request failed:', err.response ? err.response.data : err.message);
  }
}

testFederation();
