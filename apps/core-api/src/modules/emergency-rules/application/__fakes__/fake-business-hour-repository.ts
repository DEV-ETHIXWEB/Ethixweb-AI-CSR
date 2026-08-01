import type { BusinessHour } from "../../domain/business-hour.entity";
import type { BusinessHourRepository, Db } from "../../domain/ports/business-hour-repository.port";

export class FakeBusinessHourRepository implements BusinessHourRepository {
  private readonly rows: BusinessHour[] = [];

  async listByBusiness(_db: Db, tenantId: string, businessId: string): Promise<BusinessHour[]> {
    return this.rows.filter((row) => row.tenantId === tenantId && row.businessId === businessId);
  }

  /** Test helper. */
  seed(row: BusinessHour): void {
    this.rows.push(row);
  }
}
