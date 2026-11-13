const express = require('express');
const cors = require('cors');
const { ApolloServer, HeaderMap } = require('@apollo/server');
const { ApolloGateway, IntrospectAndCompose } = require('@apollo/gateway');
const client = require('prom-client');

async function startGateway() {
  const app = express();
  const PORT = 4000;

  // Prometheus Metrics Registry
  const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  const gatewayRequestsTotal = new client.Counter({
    name: 'gateway_requests_total',
    help: 'Total number of requests handled by Apollo Federation Gateway',
    labelNames: ['operationName', 'status'],
    registers: [register]
  });

  const gatewayRequestDuration = new client.Histogram({
    name: 'gateway_request_duration_seconds',
    help: 'Duration of GraphQL queries through Federation Gateway in seconds',
    labelNames: ['operationName'],
    registers: [register]
  });

  // Отказоустойчивый шлюз с IntrospectAndCompose
  const gateway = new ApolloGateway({
    supergraphSdl: new IntrospectAndCompose({
      subgraphs: [
        { name: 'catalog', url: 'http://localhost:4001' },
        { name: 'analytics', url: 'http://localhost:4002' }
      ],
      pollIntervalInMs: 15000
    })
  });

  const server = new ApolloServer({
    gateway,
    plugins: [{
      async requestDidStart(requestContext) {
        const start = process.hrtime();
        const opName = requestContext.request.operationName || 'Anonymous';
        return {
          async willSendResponse(ctx) {
            const delta = process.hrtime(start);
            const durationSec = delta[0] + delta[1] / 1e9;
            gatewayRequestDuration.labels(opName).observe(durationSec);

            const hasErrors = ctx.response.body.kind === 'single' && ctx.response.body.singleResult.errors;
            gatewayRequestsTotal.labels(opName, hasErrors ? 'error' : 'success').inc();
          }
        };
      }
    }]
  });

  await server.start();

  app.use(cors());
  app.use(express.json());

  // Эндпоинт мониторинга Prometheus
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // Healthcheck для отказоустойчивости
  app.get('/health', (req, res) => {
    res.json({
      status: 'UP',
      gateway: 'Apollo Federation 2.0',
      timestamp: new Date().toISOString()
    });
  });

  // Интеграция Apollo Server 5.x с Express без устаревшего express4 субпакета
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
    console.log(`[Apollo Gateway] 🚀 Gateway ready at http://localhost:${PORT}/graphql`);
    console.log(`[Monitoring] 📊 Prometheus metrics available at http://localhost:${PORT}/metrics`);
    console.log(`[Healthcheck] ❤️ Health endpoint at http://localhost:${PORT}/health`);
  });
}

startGateway().catch(err => {
  console.error('[Gateway Failure]', err);
});
