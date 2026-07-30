import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@ethixweb/database";
import type {
  ApiKeyAuthLookup,
  ApiKeyRepository,
  CreateApiKeyInput,
  Db,
} from "../../domain/ports/api-key-repository.port";
import type { ApiKey } from "../../domain/api-key.entity";

export class FakeApiKeyRepository implements ApiKeyRepository {
  private readonly apiKeys = new Map<string, ApiKey>();

  async findActiveByKeyHashForAuth(
    _db: PrismaClient,
    keyHash: string,
  ): Promise<ApiKeyAuthLookup | null> {
    for (const apiKey of this.apiKeys.values()) {
      if (apiKey.keyHash === keyHash) {
        return {
          id: apiKey.id,
          tenantId: apiKey.tenantId,
          scopes: apiKey.scopes,
          revokedAt: apiKey.revokedAt,
          expiresAt: apiKey.expiresAt,
        };
      }
    }
    return null;
  }

  async create(_db: Db, input: CreateApiKeyInput): Promise<ApiKey> {
    const apiKey: ApiKey = {
      id: randomUUID(),
      tenantId: input.tenantId,
      keyHash: input.keyHash,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.apiKeys.set(apiKey.id, apiKey);
    return apiKey;
  }

  async findById(_db: Db, tenantId: string, id: string): Promise<ApiKey | null> {
    const existing = this.apiKeys.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      return null;
    }
    return existing;
  }

  async listByTenant(_db: Db, tenantId: string): Promise<ApiKey[]> {
    return [...this.apiKeys.values()].filter((apiKey) => apiKey.tenantId === tenantId);
  }

  async revoke(_db: Db, tenantId: string, id: string, revokedAt: Date): Promise<ApiKey> {
    const existing = this.apiKeys.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`FakeApiKeyRepository: no key ${id} found for tenant ${tenantId}`);
    }
    const updated: ApiKey = { ...existing, revokedAt };
    this.apiKeys.set(id, updated);
    return updated;
  }
}
