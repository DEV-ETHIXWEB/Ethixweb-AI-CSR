/**
 * core-api's global route prefix is "v1" (apps/core-api/src/main.ts) — every
 * real endpoint this app calls (auth, dashboard, knowledge, capacity-config,
 * businesses) lives under that prefix. Centralized here so the prefix isn't
 * repeated/mistyped at every call site.
 *
 * Reads process.env INSIDE the function, not into a module-level constant —
 * a module-level const would capture whatever value existed at first
 * import and never re-read it, which is invisible in normal server
 * operation (the env var is genuinely static for the process's lifetime)
 * but breaks any test that mutates process.env between imports.
 */
export function coreApiUrl(path: string): string {
  const baseUrl = process.env["CORE_API_BASE_URL"] ?? "http://localhost:3000";
  return `${baseUrl}/v1${path}`;
}
