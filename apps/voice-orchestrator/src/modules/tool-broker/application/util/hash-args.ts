import { createHash } from "node:crypto";

/** docs/04 §2 stage 3's idempotency key ingredient: "call_id + tool_name + arg_hash" — a deterministic hash independent of key insertion order. */
export function hashArgs(args: unknown): string {
  return createHash("sha256").update(stableStringify(args)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
  );
  return `{${entries.join(",")}}`;
}
