import type { CoreApiClientPort } from "../../domain/ports/core-api-client.port";

export class FakeCoreApiClient implements CoreApiClientPort {
  public postResponses = new Map<string, unknown>();
  public patchResponses = new Map<string, unknown>();
  public readonly postCalls: Array<{ path: string; body: unknown }> = [];
  public readonly patchCalls: Array<{ path: string; body: unknown }> = [];
  public failWith: Error | null = null;

  async post<T>(path: string, body: unknown): Promise<T> {
    if (this.failWith) {
      throw this.failWith;
    }
    this.postCalls.push({ path, body });
    return this.postResponses.get(path) as T;
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    if (this.failWith) {
      throw this.failWith;
    }
    this.patchCalls.push({ path, body });
    return this.patchResponses.get(path) as T;
  }
}
