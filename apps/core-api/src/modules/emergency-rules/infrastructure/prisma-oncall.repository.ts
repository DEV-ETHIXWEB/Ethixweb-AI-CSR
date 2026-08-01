import { Injectable } from "@nestjs/common";
import type { OnCallRotation, OnCallShift } from "../domain/oncall.entity";
import type { Db, OnCallRepository } from "../domain/ports/oncall-repository.port";

@Injectable()
export class PrismaOnCallRepository implements OnCallRepository {
  async listRotationsByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
  ): Promise<OnCallRotation[]> {
    return db.onCallRotation.findMany({ where: { tenantId, businessId } });
  }

  async findActiveShifts(
    db: Db,
    tenantId: string,
    rotationId: string,
    at: Date,
  ): Promise<OnCallShift[]> {
    return db.onCallShift.findMany({
      where: { tenantId, rotationId, startsAt: { lte: at }, endsAt: { gt: at } },
      orderBy: { startsAt: "asc" },
    });
  }

  async findUpcomingShift(
    db: Db,
    tenantId: string,
    rotationId: string,
    after: Date,
  ): Promise<OnCallShift | null> {
    return db.onCallShift.findFirst({
      where: { tenantId, rotationId, startsAt: { gt: after } },
      orderBy: { startsAt: "asc" },
    });
  }
}
