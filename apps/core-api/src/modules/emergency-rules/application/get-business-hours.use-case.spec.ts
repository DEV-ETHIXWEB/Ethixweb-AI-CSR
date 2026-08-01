import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { BusinessHour } from "../domain/business-hour.entity";
import { FakeBusinessHourRepository } from "./__fakes__/fake-business-hour-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { GetBusinessHoursUseCase } from "./get-business-hours.use-case";

function utcTime(hours: number, minutes: number): Date {
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
}

function buildUseCase(repository: FakeBusinessHourRepository) {
  return new GetBusinessHoursUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    repository,
  );
}

describe("GetBusinessHoursUseCase", () => {
  it("returns the conservative after-hours default when nothing is configured", async () => {
    const useCase = buildUseCase(new FakeBusinessHourRepository());

    const result = await useCase.execute("tenant-1", "business-1");

    expect(result).toEqual({ isOpen: false, opensAt: null, isHoliday: false });
  });

  it("reports open when the current local time falls within today's configured window", async () => {
    const repository = new FakeBusinessHourRepository();
    const now = new Date(2026, 0, 5, 10, 0, 0); // a Monday, 10:00 local
    const row: BusinessHour = {
      id: "hours-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      dayOfWeek: now.getDay(),
      openTime: utcTime(7, 0),
      closeTime: utcTime(18, 0),
      holidayCalendarRef: null,
    };
    repository.seed(row);
    const useCase = buildUseCase(repository);

    const result = await useCase.execute("tenant-1", "business-1", now);

    expect(result).toEqual({ isOpen: true, opensAt: null, isHoliday: false });
  });

  it("reports closed with the next opening time when outside today's window", async () => {
    const repository = new FakeBusinessHourRepository();
    const now = new Date(2026, 0, 5, 20, 0, 0); // Monday, 8pm — after close
    repository.seed({
      id: "hours-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      dayOfWeek: now.getDay(),
      openTime: utcTime(7, 0),
      closeTime: utcTime(18, 0),
      holidayCalendarRef: null,
    });
    const useCase = buildUseCase(repository);

    const result = await useCase.execute("tenant-1", "business-1", now);

    expect(result.isOpen).toBe(false);
    expect(result.opensAt).not.toBeNull();
  });

  it("never reports isHoliday: true (no holiday calendar data source exists yet)", async () => {
    const useCase = buildUseCase(new FakeBusinessHourRepository());

    const result = await useCase.execute("tenant-1", "business-1");

    expect(result.isHoliday).toBe(false);
  });
});
