import { trace } from "@opentelemetry/api";

/**
 * Attaches attributes to the currently active OTel span — the mechanism
 * behind docs/01-architecture-overview.md §1 rule 7 ("every service emits
 * OpenTelemetry traces with tenant_id... as span attributes"). A no-op if
 * there's no active span (e.g. outside a request context, or when tracing
 * is disabled per apps/core-api/src/tracing.ts), so call sites never need
 * to guard against tracing being off.
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}
