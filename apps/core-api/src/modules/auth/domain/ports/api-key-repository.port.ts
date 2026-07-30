import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { ApiKey } from "../api-key.entity";

/** `api_keys` is RLS-scoped for normal (tenant-scoped) access — see ADR-015 for the auth-time exception. */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateApiKeyInput {
  tenantId: string;
  keyHash: string;
  scopes: string;
  expiresAt: Date | null;
}

/**
 * The narrow, fixed shape `lookup_api_key_for_auth()` returns — deliberately
 * not the full `ApiKey` entity: no `keyHash` (nothing needs it once the
 * lookup has already matched), no `createdAt` (irrelevant to authentication).
 */
export interface ApiKeyAuthLookup {
  id: string;
  tenantId: string;
  scopes: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export interface ApiKeyRepository {
  /**
   * Authentication-time lookup, per docs/20-architecture-decision-records.md
   * ADR-015 — runs against the plain `PrismaClient` (never a tenant-scoped
   * transaction), because the caller's tenant_id is exactly what this
   * resolves. Backed by the `lookup_api_key_for_auth` SECURITY DEFINER SQL
   * function, not a normal Prisma model query — RLS would otherwise return
   * zero rows for a query that structurally cannot have tenant context set.
   */
  findActiveByKeyHashForAuth(db: PrismaClient, keyHash: string): Promise<ApiKeyAuthLookup | null>;

  create(db: Db, input: CreateApiKeyInput): Promise<ApiKey>;
  /**
   * `tenantId` passed explicitly AND the query runs inside an
   * already-tenant-scoped RLS transaction — the same defense-in-depth
   * reasoning as UserRepository.findByEmail. Without it, an IDOR test
   * ("tenant A cannot revoke tenant B's key by id") would only be caught by
   * RLS in production and couldn't even be *written* correctly against an
   * in-memory test fake, which has no equivalent of RLS to fall back on.
   */
  findById(db: Db, tenantId: string, id: string): Promise<ApiKey | null>;
  listByTenant(db: Db, tenantId: string): Promise<ApiKey[]>;
  revoke(db: Db, tenantId: string, id: string, revokedAt: Date): Promise<ApiKey>;
}

export const API_KEY_REPOSITORY = Symbol("API_KEY_REPOSITORY");
