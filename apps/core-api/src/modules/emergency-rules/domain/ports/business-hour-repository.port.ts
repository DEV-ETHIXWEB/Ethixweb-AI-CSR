import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { BusinessHour } from "../business-hour.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface BusinessHourRepository {
  listByBusiness(db: Db, tenantId: string, businessId: string): Promise<BusinessHour[]>;
}

export const BUSINESS_HOUR_REPOSITORY = Symbol("BUSINESS_HOUR_REPOSITORY");
