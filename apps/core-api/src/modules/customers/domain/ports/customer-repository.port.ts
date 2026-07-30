import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { Customer } from "../customer.entity";

/** `customers` IS RLS-scoped — every method takes the tenant-scoped transaction client (docs/20 ADR-014). */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateCustomerInput {
  tenantId: string;
  businessId: string;
  phoneE164: string;
  name: string;
  email?: string | undefined;
  address?: Record<string, unknown> | undefined;
  crmCustomerId?: string | undefined;
  crmRawCache?: unknown;
}

export interface UpdateCrmCacheInput {
  crmCustomerId?: string | undefined;
  name?: string | undefined;
  email?: string | undefined;
  address?: Record<string, unknown> | undefined;
  crmRawCache?: unknown;
}

export interface ListCustomersOptions {
  page: number;
  pageSize: number;
  /** Case-insensitive partial match against name OR phoneE164 — no full-text search infra exists, and none is needed at Phase 1's per-business customer-list scale. */
  search?: string | undefined;
}

export interface ListCustomersResult {
  items: Customer[];
  total: number;
}

export interface CustomerRepository {
  /**
   * Throws (a raw error, not a domain error — see PrismaCustomerRepository's
   * own comment) on a `(businessId, phoneE164)` unique-constraint violation.
   * Callers (CreateCustomerUseCase) are expected to catch this specific
   * case and treat it as "someone else already created this customer
   * concurrently" per docs/13-implementation-backlog.md `customers` module
   * §4 — the documented, required behavior for this exact race, not an
   * unexpected failure mode.
   */
  create(db: Db, input: CreateCustomerInput): Promise<Customer>;
  /** Tenant-scoped defense in depth, same reasoning as every other tenant-scoped `findById` in this codebase. */
  findById(db: Db, tenantId: string, id: string): Promise<Customer | null>;
  /** The core cache-lookup this entire module exists for — docs/05-crm-integration.md §4's "Local DB lookup: UNIQUE(business_id, phone_e164)". */
  findByPhone(
    db: Db,
    tenantId: string,
    businessId: string,
    phoneE164: string,
  ): Promise<Customer | null>;
  /** Refreshes the CRM-sourced fields after a fresh read — never touched by any user-facing "edit customer" path, because there isn't one (see customer.entity.ts's own comment on why). */
  updateCrmCache(
    db: Db,
    tenantId: string,
    id: string,
    patch: UpdateCrmCacheInput,
  ): Promise<Customer>;
  listByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListCustomersOptions,
  ): Promise<ListCustomersResult>;
}

export const CUSTOMER_REPOSITORY = Symbol("CUSTOMER_REPOSITORY");
