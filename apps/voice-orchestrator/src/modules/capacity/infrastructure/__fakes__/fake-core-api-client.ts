import type { CoreApiClientPort } from "../../../tool-broker/domain/ports/core-api-client.port";

/**
 * A per-path-configurable fake, distinct from tool-broker's own
 * FakeCoreApiClient (which fails ALL calls uniformly via one `failWith`) —
 * HttpCapacityConfigProvider's tests need the capacity-config and
 * waiting-brochure fetches to fail INDEPENDENTLY of each other (see that
 * provider's own comment on why), which a single shared failure flag can't
 * express.
 */
export class FakeCoreApiClient implements CoreApiClientPort {
  public readonly getResponses = new Map<string, unknown>();
  public readonly getFailures = new Map<string, Error>();
  public readonly getCalls: string[] = [];

  async get<T>(path: string): Promise<T> {
    this.getCalls.push(path);
    const failure = this.getFailures.get(path);
    if (failure) {
      throw failure;
    }
    return this.getResponses.get(path) as T;
  }

  async post<T>(_path: string, _body: unknown): Promise<T> {
    throw new Error("FakeCoreApiClient.post: not used by HttpCapacityConfigProvider");
  }

  async patch<T>(_path: string, _body: unknown): Promise<T> {
    throw new Error("FakeCoreApiClient.patch: not used by HttpCapacityConfigProvider");
  }
}
