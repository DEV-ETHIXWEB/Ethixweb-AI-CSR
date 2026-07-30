import { Injectable } from "@nestjs/common";
import type { PrismaClient, TenantStatus } from "@ethixweb/database";
import { ConcurrentTenantModificationError } from "../domain/errors";
import type { Tenant } from "../domain/tenant.entity";
import type {
  CreateTenantInput,
  TenantRepository,
  UpdateTenantInput,
} from "../domain/ports/tenant-repository.port";

@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  async create(db: PrismaClient, input: CreateTenantInput): Promise<Tenant> {
    return db.tenant.create({
      data: {
        name: input.name,
        planTier: input.planTier ?? "trial",
      },
    });
  }

  async findById(db: PrismaClient, id: string): Promise<Tenant | null> {
    return db.tenant.findUnique({ where: { id } });
  }

  async update(db: PrismaClient, id: string, input: UpdateTenantInput): Promise<Tenant> {
    return db.tenant.update({ where: { id }, data: { name: input.name } });
  }

  async updateStatus(
    db: PrismaClient,
    id: string,
    fromStatus: TenantStatus,
    toStatus: TenantStatus,
  ): Promise<Tenant> {
    // Conditional update — `WHERE id = id AND status = fromStatus` — is the
    // actual optimistic-concurrency-control mechanism; see the port's own
    // comment on the write-write race an unconditional update would allow.
    const { count } = await db.tenant.updateMany({
      where: { id, status: fromStatus },
      data: { status: toStatus },
    });
    if (count === 0) {
      throw new ConcurrentTenantModificationError(id);
    }
    const updated = await db.tenant.findUnique({ where: { id } });
    if (!updated) {
      // Unreachable in practice (just updated it above) — satisfies the
      // non-null return type without a non-null assertion.
      throw new Error(`PrismaTenantRepository.updateStatus: tenant ${id} vanished after update`);
    }
    return updated;
  }
}
