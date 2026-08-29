import { Injectable } from "@nestjs/common";
import { ToolHandlerError } from "../domain/tool-definition";
import type { CoreApiClientPort } from "../domain/ports/core-api-client.port";

const DEFAULT_BASE_URL = "http://localhost:3000/v1";

// Every caller of this client sits on the live-call path (tool handlers,
// capacity-config, the AI-knowledge prompt-assembly fetch, and the
// Call-row creation StartConversationUseCase/EndConversationUseCase make
// directly), and Node's native fetch has NO default request timeout at
// all. Reproduced live: pointed this client at a server that accepts the
// TCP connection but never responds, then fired a real POST
// /v1/conversations, it hung for the full 60s test ceiling with zero
// response, meaning a real caller would sit in dead air indefinitely if
// core-api ever merely hangs (not even errors) rather than being
// unreachable outright (a distinct, unprotected failure mode from "core-api
// down", which every caller here already catches and falls back from).
// Set above the tool catalog's own highest per-tool timeoutMs (3000ms, see
// tool-catalog.ts) so this is a backstop for the callers that have no
// timeout of their own, not a second, conflicting timeout racing the one
// ExecuteToolUseCase's withTimeout already applies per tool.
const REQUEST_TIMEOUT_MS = 5000;

/**
 * A single static service credential (`CORE_API_SERVICE_API_KEY`), not a
 * per-tenant credential lookup, matches docs/01-architecture-overview.md
 * §9's own stated deployment reality for this phase ("over-engineering for
 * a Phase 1 single-tenant pilot" is the EXACT phrase used to justify
 * Fargate-over-EKS in that same section, and the README confirms the
 * first real deployment is a single tenant, All Phase Plumbing). A
 * per-tenant credential-provisioning scheme is real future work once a
 * second tenant actually onboards, not invented speculatively here.
 */
@Injectable()
export class HttpCoreApiClient implements CoreApiClientPort {
  private readonly baseUrl = process.env["CORE_API_BASE_URL"] ?? DEFAULT_BASE_URL;

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path, undefined);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  private async request<T>(method: string, path: string, body: unknown): Promise<T> {
    const apiKey = process.env["CORE_API_SERVICE_API_KEY"];
    if (!apiKey) {
      throw new ToolHandlerError("CORE_API_SERVICE_API_KEY is not configured", false);
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      // Covers both a network-level failure (connection refused, DNS) and
      // the timeout above firing (AbortSignal.timeout rejects fetch with a
      // DOMException named "TimeoutError"), same ToolHandlerError shape
      // callers already handle for a non-ok HTTP response, so every
      // caller's existing catch-and-fallback or retry logic covers this
      // failure mode too without needing its own special case. Checks
      // `.name` directly rather than gating on `instanceof Error` first:
      // a DOMException is an Error in real Node.js execution, but that
      // check proved unreliable across the realm boundary Jest's test
      // environment introduces, found by the regression test for this
      // exact branch failing against a manually-constructed DOMException.
      const errorName = (error as { name?: unknown } | null)?.name;
      const isTimeout = errorName === "TimeoutError";
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new ToolHandlerError(
        `core-api ${method} ${path} ${isTimeout ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : `failed: ${errorMessage}`}`,
        true,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      throw new ToolHandlerError(
        `core-api ${method} ${path} failed (${response.status}): ${text}`,
        retryable,
      );
    }

    return (await response.json()) as T;
  }
}
