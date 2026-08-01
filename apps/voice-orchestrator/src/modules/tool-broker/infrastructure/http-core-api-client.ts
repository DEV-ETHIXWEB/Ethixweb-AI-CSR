import { Injectable } from "@nestjs/common";
import { ToolHandlerError } from "../domain/tool-definition";
import type { CoreApiClientPort } from "../domain/ports/core-api-client.port";

const DEFAULT_BASE_URL = "http://localhost:3000/v1";

/**
 * A single static service credential (`CORE_API_SERVICE_API_KEY`), not a
 * per-tenant credential lookup — matches docs/01-architecture-overview.md
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

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify(body),
    });

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
