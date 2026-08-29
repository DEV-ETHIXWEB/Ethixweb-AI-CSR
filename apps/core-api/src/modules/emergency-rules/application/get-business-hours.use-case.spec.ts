import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { GetBusinessUseCase } from "../../tenants/application/get-business.use-case";
import type { BusinessHour } from "../domain/business-hour.entity";
import { FakeBusinessHourRepository } from "./__fakes__/fake-business-hour-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { GetBusinessHoursUseCase } from "./get-business-hours.use-case";

function utcTime(hours: number, minutes: number): Date {
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
}

function fakeGetBusinessUseCase(timezone: string): GetBusinessUseCase {
  return {
    execute: jest.fn().mockResolvedValue({
      id: "business-1",
      tenantId: "tenant-1",
      name: "Test Business",
      timezone,
      crmType: "housecall_pro",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  } as unknown as GetBusinessUseCase;
}

function buildUseCase(repository: FakeBusinessHourRepository, timezone = "UTC") {
  return new GetBusinessHoursUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    repository,
    fakeGetBusinessUseCase(timezone),
  );
}

describe("GetBusinessHoursUseCase", () => {
  it("returns the conservative after-hours default when nothing is configured", async () => {
    const useCase = buildUseCase(new FakeBusinessHourRepository());

    const result = await useCase.execute("tenant-1", "business-1");

    expect(result).toEqual({ isOpen: false, opensAt: null, isHoliday: false });
  });

  it("reports open when the current time falls within today's configured window, in the business's own UTC timezone", async () => {
    const repository = new FakeBusinessHourRepository();
    const now = new Date(Date.UTC(2026, 0, 5, 10, 0, 0)); // a Monday, 10:00 UTC
    const row: BusinessHour = {
      id: "hours-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      dayOfWeek: 1, // Monday
      openTime: utcTime(7, 0),
      closeTime: utcTime(18, 0),
      holidayCalendarRef: null,
    };
    repository.seed(row);
    const useCase = buildUseCase(repository, "UTC");

    const result = await useCase.execute("tenant-1", "business-1", now);

    expect(result).toEqual({ isOpen: true, opensAt: null, isHoliday: false });
  });

  it("reports closed with the next opening time when outside today's window", async () => {
    const repository = new FakeBusinessHourRepository();
    const now = new Date(Date.UTC(2026, 0, 5, 20, 0, 0)); // Monday, 8pm UTC — after close
    repository.seed({
      id: "hours-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      dayOfWeek: 1, // Monday
      openTime: utcTime(7, 0),
      closeTime: utcTime(18, 0),
      holidayCalendarRef: null,
    });
    const useCase = buildUseCase(repository, "UTC");

    const result = await useCase.execute("tenant-1", "business-1", now);

    expect(result.isOpen).toBe(false);
    expect(result.opensAt).not.toBeNull();
  });

  it("never reports isHoliday: true (no holiday calendar data source exists yet)", async () => {
    const useCase = buildUseCase(new FakeBusinessHourRepository());

    const result = await useCase.execute("tenant-1", "business-1");

    expect(result.isHoliday).toBe(false);
  });

  /**
   * Regression coverage for a real bug found live: this use case used to
   * compare the SERVER PROCESS's own local timezone hour (via
   * `Date.prototype.getHours()`) against `openTime.getUTCHours()`, with no
   * connection to the business's own configured timezone at all. Uses
   * America/Chicago specifically (a real, DST-observing zone genuinely
   * different from UTC) so this test fails under the old server-local-only
   * comparison regardless of what timezone the test runner itself happens
   * to execute in.
   */
  it("TIMEZONE CORRECTNESS: evaluates against the business's own configured timezone, not the server process's local timezone", async () => {
    const repository = new FakeBusinessHourRepository();
    // 14:30 UTC on a Saturday = 08:30 in America/Chicago (CST, UTC-6, in
    // January) — squarely inside an 08:00-18:00 window.
    const now = new Date(Date.UTC(2026, 0, 3, 14, 30, 0)); // Saturday
    repository.seed({
      id: "hours-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      dayOfWeek: 6, // Saturday — America/Chicago's local calendar day at this instant
      openTime: utcTime(8, 0),
      closeTime: utcTime(18, 0),
      holidayCalendarRef: null,
    });
    const useCase = buildUseCase(repository, "America/Chicago");

    const result = await useCase.execute("tenant-1", "business-1", now);

    expect(result).toEqual({ isOpen: true, opensAt: null, isHoliday: false });
  });

  it("TIMEZONE CORRECTNESS: reports closed (not open) once past close time in the business's own timezone, even while it's still within a naive server-local reading of the same UTC hour", async () => {
    const repository = new FakeBusinessHourRepository();
    // 23:30 UTC on a Monday = 17:30 CST in America/Chicago — already past
    // an 08:00-16:00 close.
    const now = new Date(Date.UTC(2026, 0, 5, 23, 30, 0)); // Monday
    repository.seed({
      id: "hours-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      dayOfWeek: 1, // Monday
      openTime: utcTime(8, 0),
      closeTime: utcTime(16, 0),
      holidayCalendarRef: null,
    });
    const useCase = buildUseCase(repository, "America/Chicago");

    const result = await useCase.execute("tenant-1", "business-1", now);

    expect(result.isOpen).toBe(false);
  });
});
