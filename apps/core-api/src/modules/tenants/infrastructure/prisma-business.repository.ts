import { Injectable } from "@nestjs/common";
import type { Business } from "../domain/business.entity";
import type {
  BusinessRepository,
  CreateBusinessInput,
  Db,
  UpdateBusinessInput,
} from "../domain/ports/business-repository.port";

@Injectable()
export class PrismaBusinessRepository implements BusinessRepository {
  async create(db: Db, input: CreateBusinessInput): Promise<Business> {
    return db.business.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        timezone: input.timezone,
        crmType: input.crmType,
      },
    });
  }

  async findById(db: Db, tenantId: string, id: string): Promise<Business | null> {
    return db.business.findFirst({ where: { id, tenantId } });
  }

  async listByTenant(db: Db, tenantId: string): Promise<Business[]> {
    return db.business.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  }

  async update(
    db: Db,
    tenantId: string,
    id: string,
    input: UpdateBusinessInput,
  ): Promise<Business> {
    // `update()` requires a unique-field WHERE (id alone) — updateMany + a
    // re-fetch keeps the explicit tenantId check without a compound unique
    // constraint the schema doesn't have, the same pattern used for API key
    // revocation in the auth module.
    const { count } = await db.business.updateMany({
      where: { id, tenantId },
      data: { name: input.name, timezone: input.timezone },
    });
    if (count === 0) {
      throw new Error(
        `PrismaBusinessRepository.update: no business ${id} found for tenant ${tenantId}`,
      );
    }
    const updated = await db.business.findFirst({ where: { id, tenantId } });
    if (!updated) {
      throw new Error(`PrismaBusinessRepository.update: business ${id} vanished after update`);
    }
    return updated;
  }
}
