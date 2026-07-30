import type { PrismaClient, TenantStatus } from "@ethixweb/database";
import type { Tenant } from "../tenant.entity";

/**
 * `tenants` carries no `tenant_id` of its own and has no RLS policy — see
 * docs/20-architecture-decision-records.md ADR-013 — so this port operates
 * against the plain `PrismaClient`, never a tenant-scoped transaction client.
 */
export interface CreateTenantInput {
  name: string;
  // Explicitly `string | undefined` (not just `?: string`) because callers
  // pass through an already-optional DTO field, which under
  // `exactOptionalPropertyTypes` is a distinct type from a simply-omittable
  // property — see docs/14-backend-stack-and-code-standards.md §1 (strict
  // TypeScript config) for why that flag is on at all.
  planTier?: string | undefined;
}

export interface UpdateTenantInput {
  name: string;
}

export interface TenantRepository {
  create(db: PrismaClient, input: CreateTenantInput): Promise<Tenant>;
  findById(db: PrismaClient, id: string): Promise<Tenant | null>;
  update(db: PrismaClient, id: string, input: UpdateTenantInput): Promise<Tenant>;
  /**
   * `fromStatus` is required, not just `toStatus` — a plain unconditional
   * `UPDATE ... SET status = toStatus WHERE id = id` has a real write-write
   * race: two concurrent transitions off the same starting status (e.g. one
   * request moving active->suspended, another moving the same
   * active->past_due) would both pass the use-case's own graph validation
   * and both write, with whichever commits last silently discarding the
   * other — no error, no signal a race happened. Implementations must do a
   * conditional update (`WHERE id = id AND status = fromStatus`) and throw
   * ConcurrentTenantModificationError (../errors.ts) if no row matched,
   * the same optimistic-concurrency-control pattern already used for API
   * key revocation in the auth module.
   */
  updateStatus(
    db: PrismaClient,
    id: string,
    fromStatus: TenantStatus,
    toStatus: TenantStatus,
  ): Promise<Tenant>;
}

export const TENANT_REPOSITORY = Symbol("TENANT_REPOSITORY");
