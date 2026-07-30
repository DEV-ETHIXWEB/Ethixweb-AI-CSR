import type { PrismaClient, TenantStatus } from "@ethixweb/database";
import { ConcurrentTenantModificationError } from "../../domain/errors";
import type {
  CreateTenantInput,
  TenantRepository,
  UpdateTenantInput,
} from "../../domain/ports/tenant-repository.port";
import type { Tenant } from "../../domain/tenant.entity";

/** In-memory fake used across the tenants module's unit tests — no Prisma/DB involved. */
export class FakeTenantRepository implements TenantRepository {
  private readonly tenants = new Map<string, Tenant>();
  private nextId = 1;

  async create(_db: PrismaClient, input: CreateTenantInput): Promise<Tenant> {
    const now = new Date();
    const tenant: Tenant = {
      id: `tenant-${this.nextId++}`,
      name: input.name,
      planTier: input.planTier ?? "trial",
      status: "trial",
      createdAt: now,
      updatedAt: now,
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async findById(_db: PrismaClient, id: string): Promise<Tenant | null> {
    return this.tenants.get(id) ?? null;
  }

  async update(_db: PrismaClient, id: string, input: UpdateTenantInput): Promise<Tenant> {
    const existing = this.tenants.get(id);
    if (!existing) {
      throw new Error(`FakeTenantRepository: no tenant seeded with id ${id}`);
    }
    const updated: Tenant = { ...existing, name: input.name, updatedAt: new Date() };
    this.tenants.set(id, updated);
    return updated;
  }

  // Synchronous body (no internal `await`) so this check-then-set is
  // genuinely atomic with respect to other in-flight calls — mirrors the
  // real repository's `updateMany({ id, status: fromStatus })` conditional
  // update, and the same reasoning already used for FakeUserRepository /
  // FakeRefreshTokenStore in the auth module.
  async updateStatus(
    _db: PrismaClient,
    id: string,
    fromStatus: TenantStatus,
    toStatus: TenantStatus,
  ): Promise<Tenant> {
    const existing = this.tenants.get(id);
    if (!existing || existing.status !== fromStatus) {
      throw new ConcurrentTenantModificationError(id);
    }
    const updated: Tenant = { ...existing, status: toStatus, updatedAt: new Date() };
    this.tenants.set(id, updated);
    return updated;
  }

  /** Test helper — seed a tenant directly without going through `create`. */
  seed(tenant: Tenant): void {
    this.tenants.set(tenant.id, tenant);
  }
}
