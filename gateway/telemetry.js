const opentelemetry = require('@opentelemetry/api');
const { MeterProvider } = require('@opentelemetry/sdk-metrics');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { resourceFromAttributes } = require('@opentelemetry/resources');

const resource = resourceFromAttributes({
  'service.name': 'graphql-federation-gateway'
});

const otlpExporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces'
});

const tracerProvider = new NodeTracerProvider({
  resource,
  spanProcessors: [new SimpleSpanProcessor(otlpExporter)]
});

tracerProvider.register();

const tracer = opentelemetry.trace.getTracer('graphql-gateway-tracer');

const prometheusExporter = new PrometheusExporter({
  port: 9464,
  endpoint: '/metrics'
});

const meterProvider = new MeterProvider({
  resource,
  readers: [prometheusExporter]
});

const meter = meterProvider.getMeter('graphql-gateway-meter');

const graphQLQueryCounter = meter.createCounter('graphql_operations_total', {
  description: 'Count of total executed GraphQL operations through Apollo Federation'
});

const graphQLQueryDuration = meter.createHistogram('graphql_operation_duration_ms', {
  description: 'Execution duration of GraphQL operations through Apollo Federation in ms',
  unit: 'ms'
});

module.exports = {
  tracer,
  graphQLQueryCounter,
  graphQLQueryDuration
};
