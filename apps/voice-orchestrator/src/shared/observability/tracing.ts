import { trace } from "@opentelemetry/api";

/** Identical to apps/core-api's own helper — see that file's comment. */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}
