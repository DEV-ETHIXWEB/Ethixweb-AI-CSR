import type { OnCallRotation, OnCallShift } from "../../domain/oncall.entity";
import type { Db, OnCallRepository } from "../../domain/ports/oncall-repository.port";

export class FakeOnCallRepository implements OnCallRepository {
  private readonly rotations: OnCallRotation[] = [];
  private readonly shifts: OnCallShift[] = [];

  async listRotationsByBusiness(
    _db: Db,
    tenantId: string,
    businessId: string,
  ): Promise<OnCallRotation[]> {
    return this.rotations.filter((r) => r.tenantId === tenantId && r.businessId === businessId);
  }

  async findActiveShifts(
    _db: Db,
    tenantId: string,
    rotationId: string,
    at: Date,
  ): Promise<OnCallShift[]> {
    return this.shifts.filter(
      (s) =>
        s.tenantId === tenantId && s.rotationId === rotationId && s.startsAt <= at && s.endsAt > at,
    );
  }

  async findUpcomingShift(
    _db: Db,
    tenantId: string,
    rotationId: string,
    after: Date,
  ): Promise<OnCallShift | null> {
    const upcoming = this.shifts
      .filter((s) => s.tenantId === tenantId && s.rotationId === rotationId && s.startsAt > after)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return upcoming[0] ?? null;
  }

  /** Test helpers. */
  seedRotation(rotation: OnCallRotation): void {
    this.rotations.push(rotation);
  }
  seedShift(shift: OnCallShift): void {
    this.shifts.push(shift);
  }
}
