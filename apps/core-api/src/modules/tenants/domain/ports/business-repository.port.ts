import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { Business } from "../business.entity";

/**
 * `businesses` IS RLS-scoped, so every method here takes the
 * `TenantScopedDb` produced by `TenantContextService.run()` — either the
 * plain client (never used directly against this table in production code)
 * or, correctly, the `Prisma.TransactionClient` with `app.tenant_id` set for
 * this transaction (docs/20 ADR-014).
 */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateBusinessInput {
  tenantId: string;
  name: string;
  timezone: string;
  crmType: string;
}

export interface UpdateBusinessInput {
  name: string;
  timezone: string;
}

export interface BusinessRepository {
  create(db: Db, input: CreateBusinessInput): Promise<Business>;
  /**
   * `tenantId` passed explicitly AND the query runs inside an
   * already-tenant-scoped RLS transaction — the same defense-in-depth
   * reasoning as every tenant-scoped lookup in the auth module
   * (ApiKeyRepository.findById, UserRepository.findById). Without it, an
   * IDOR test ("tenant A cannot read tenant B's business by id") would only
   * be caught by RLS in production and couldn't even be written correctly
   * against an in-memory test fake, which has no equivalent of RLS.
   */
  findById(db: Db, tenantId: string, id: string): Promise<Business | null>;
  listByTenant(db: Db, tenantId: string): Promise<Business[]>;
  update(db: Db, tenantId: string, id: string, input: UpdateBusinessInput): Promise<Business>;
}

export const BUSINESS_REPOSITORY = Symbol("BUSINESS_REPOSITORY");
