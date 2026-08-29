/**
 * OpenTelemetry bootstrap — identical rationale/pattern to
 * apps/voice-orchestrator/src/tracing.ts: must be the first thing main.ts
 * imports, and an unreachable OTel Collector must never crash this service
 * (a dropped span is acceptable; a dropped call is not).
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
    // eslint-disable-next-line no-console -- no Nest/DI logger exists yet at this point in bootstrap
    console.warn("OpenTelemetry SDK failed to start; continuing without tracing.", error);
  }
}

export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
}
