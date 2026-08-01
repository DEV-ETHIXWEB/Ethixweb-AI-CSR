import { Injectable } from "@nestjs/common";
import type { BusinessHour } from "../domain/business-hour.entity";
import type { BusinessHourRepository, Db } from "../domain/ports/business-hour-repository.port";

@Injectable()
export class PrismaBusinessHourRepository implements BusinessHourRepository {
  async listByBusiness(db: Db, tenantId: string, businessId: string): Promise<BusinessHour[]> {
    return db.businessHour.findMany({ where: { tenantId, businessId } });
  }
}
