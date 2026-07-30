/**
 * OpenTelemetry bootstrap, per docs/08-security-observability-reliability.md §2.1.
 * Must be the first thing `main.ts` imports (before Nest/Prisma/etc. are
 * required) so auto-instrumentation can patch those modules on load. A
 * missing/unreachable OTel Collector must never crash the app — an exporter
 * failure only means spans aren't shipped, not that the API goes down.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const OTEL_DISABLED =
  process.env["NODE_ENV"] === "test" || process.env["OTEL_SDK_DISABLED"] === "true";

let sdk: NodeSDK | undefined;

export function startTracing(serviceName: string): void {
  if (OTEL_DISABLED) {
    return;
  }

  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4318/v1/traces",
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  try {
    sdk.start();
  } catch (error) {
    // Tracing is observability, not a service dependency — a Collector that
    // isn't reachable yet (e.g. local dev without the Grafana stack running)
    // must never prevent the API from starting.
    // eslint-disable-next-line no-console
    console.warn("OpenTelemetry SDK failed to start; continuing without tracing.", error);
  }
}

export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
}
