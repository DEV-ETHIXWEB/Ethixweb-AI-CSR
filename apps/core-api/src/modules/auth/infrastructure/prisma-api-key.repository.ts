import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@ethixweb/database";
import type { ApiKey } from "../domain/api-key.entity";
import type {
  ApiKeyAuthLookup,
  ApiKeyRepository,
  CreateApiKeyInput,
  Db,
} from "../domain/ports/api-key-repository.port";

interface AuthLookupRow {
  id: string;
  tenant_id: string;
  scopes: string;
  revoked_at: Date | null;
  expires_at: Date | null;
}

@Injectable()
export class PrismaApiKeyRepository implements ApiKeyRepository {
  /** See docs/20-architecture-decision-records.md ADR-015 — calls the SECURITY DEFINER function, not a normal Prisma model query. */
  async findActiveByKeyHashForAuth(
    db: PrismaClient,
    keyHash: string,
  ): Promise<ApiKeyAuthLookup | null> {
    const rows = await db.$queryRaw<
      AuthLookupRow[]
    >`SELECT * FROM lookup_api_key_for_auth(${keyHash})`;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      tenantId: row.tenant_id,
      scopes: row.scopes,
      revokedAt: row.revoked_at,
      expiresAt: row.expires_at,
    };
  }

  async create(db: Db, input: CreateApiKeyInput): Promise<ApiKey> {
    return db.apiKey.create({
      data: {
        tenantId: input.tenantId,
        keyHash: input.keyHash,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
      },
    });
  }

  async findById(db: Db, tenantId: string, id: string): Promise<ApiKey | null> {
    return db.apiKey.findFirst({ where: { id, tenantId } });
  }

  async listByTenant(db: Db, tenantId: string): Promise<ApiKey[]> {
    return db.apiKey.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  }

  async revoke(db: Db, tenantId: string, id: string, revokedAt: Date): Promise<ApiKey> {
    // `update()` requires a unique-field WHERE (id alone), which can't
    // also carry an explicit tenantId filter without a compound unique
    // constraint the schema doesn't have — `updateMany` + a re-fetch is
    // the way to keep the explicit tenantId check without that schema
    // change. The caller (RevokeApiKeyUseCase) already verifies ownership
    // via findById first, so this is defense-in-depth against a future
    // caller that skips that step, not the only check in practice today.
    const { count } = await db.apiKey.updateMany({ where: { id, tenantId }, data: { revokedAt } });
    if (count === 0) {
      throw new Error(`PrismaApiKeyRepository.revoke: no key ${id} found for tenant ${tenantId}`);
    }
    const updated = await db.apiKey.findFirst({ where: { id, tenantId } });
    if (!updated) {
      // Unreachable in practice (we just updated it inside the same
      // tenant-scoped transaction) — satisfies the non-null return type
      // without a non-null assertion.
      throw new Error(`PrismaApiKeyRepository.revoke: key ${id} vanished after update`);
    }
    return updated;
  }
}
