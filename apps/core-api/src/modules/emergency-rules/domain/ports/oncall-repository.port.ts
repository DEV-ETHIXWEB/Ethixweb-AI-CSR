import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { OnCallRotation, OnCallShift } from "../oncall.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface OnCallRepository {
  listRotationsByBusiness(db: Db, tenantId: string, businessId: string): Promise<OnCallRotation[]>;
  /** Shifts covering `at`, for the given rotation — the candidate pool the resolver walks through in configured strategy order. */
  findActiveShifts(db: Db, tenantId: string, rotationId: string, at: Date): Promise<OnCallShift[]>;
  /** All shifts for a rotation, ordered by startsAt — used to find the NEXT upcoming shift when nothing is active right now (docs/07 §5.3's "no fallback shift" branch). */
  findUpcomingShift(
    db: Db,
    tenantId: string,
    rotationId: string,
    after: Date,
  ): Promise<OnCallShift | null>;
}

export const ONCALL_REPOSITORY = Symbol("ONCALL_REPOSITORY");
