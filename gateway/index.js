const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { ApolloServer, HeaderMap } = require('@apollo/server');
const { ApolloGateway, IntrospectAndCompose } = require('@apollo/gateway');
const { tracer, graphQLQueryCounter, graphQLQueryDuration } = require('./telemetry');

async function waitForSubgraphs(urls, retries = 30, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      await Promise.all(
        urls.map(u => axios.post(u, { query: '{ __typename }' }, { timeout: 2000 }))
      );
      return;
    } catch (_) {
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function startGateway() {
  const app = express();
  const PORT = 4000;
  const subgraphs = [
    { name: 'catalog', url: 'http://localhost:4001' },
    { name: 'analytics', url: 'http://localhost:4002' }
  ];

  await waitForSubgraphs(subgraphs.map(s => s.url));

  const gateway = new ApolloGateway({
    supergraphSdl: new IntrospectAndCompose({
      subgraphs,
      pollIntervalInMs: 15000
    })
  });

  const server = new ApolloServer({
    gateway,
    plugins: [{
      async requestDidStart(requestContext) {
        const opName = requestContext.request.operationName || 'Anonymous';
        const span = tracer.startSpan(`GraphQL Operation: ${opName}`);
        span.setAttribute('graphql.operation.name', opName);

        const startTime = Date.now();

        return {
          async willSendResponse(ctx) {
            const duration = Date.now() - startTime;
            graphQLQueryDuration.record(duration, { operation: opName });

            const hasErrors = ctx.response.body.kind === 'single' && ctx.response.body.singleResult.errors;
            graphQLQueryCounter.add(1, { 
              operation: opName, 
              status: hasErrors ? 'error' : 'success' 
            });

            span.setAttribute('graphql.status', hasErrors ? 'error' : 'success');
            span.end();
          }
        };
      }
    }]
  });

  await server.start();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({
      status: 'UP',
      gateway: 'Apollo Federation 2.0',
      telemetry: 'OpenTelemetry + Prometheus Exporter (Port 9464)',
      timestamp: new Date().toISOString()
    });
  });

  app.use('/graphql', async (req, res) => {
    const headers = new HeaderMap();
    for (const [key, val] of Object.entries(req.headers)) {
      if (val !== undefined) {
        headers.set(key, Array.isArray(val) ? val.join(', ') : val);
      }
    }

    const httpGraphQLResponse = await server.executeHTTPGraphQLRequest({
      httpGraphQLRequest: {
        method: req.method.toUpperCase(),
        headers,
        search: req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '',
        body: req.body
      },
      context: async () => ({})
    });

    for (const [headerKey, headerVal] of httpGraphQLResponse.headers) {
      res.setHeader(headerKey, headerVal);
    }
    res.status(httpGraphQLResponse.status || 200);

    if (httpGraphQLResponse.body.kind === 'complete') {
      res.send(httpGraphQLResponse.body.string);
    } else {
      for await (const chunk of httpGraphQLResponse.body.asyncIterator) {
        res.write(chunk);
      }
      res.end();
    }
  });

  app.listen(PORT, () => {
    console.log(`[Apollo Gateway] Ready at http://localhost:${PORT}/graphql`);
    console.log(`[OpenTelemetry Prometheus] Exporter live at http://localhost:9464/metrics`);
  });
}

startGateway().catch(err => {
  console.error('[Gateway Failure]', err);
});
