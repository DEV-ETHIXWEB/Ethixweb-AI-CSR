import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { FakeOnCallRepository } from "./__fakes__/fake-oncall-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ResolveOnCallUseCase } from "./resolve-oncall.use-case";

function buildUseCase(repository: FakeOnCallRepository) {
  return new ResolveOnCallUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    repository,
  );
}

describe("ResolveOnCallUseCase", () => {
  it("returns no targets when the business has no rotation configured", async () => {
    const useCase = buildUseCase(new FakeOnCallRepository());

    const result = await useCase.execute("tenant-1", "business-1");

    expect(result).toEqual({ targets: [], strategy: null });
  });

  it("returns the active shift's phoneOverride as the target", async () => {
    const repository = new FakeOnCallRepository();
    repository.seedRotation({
      id: "rot-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      name: "Primary",
      strategy: "priority_list",
    });
    const now = new Date("2026-01-05T12:00:00.000Z");
    repository.seedShift({
      id: "shift-1",
      tenantId: "tenant-1",
      rotationId: "rot-1",
      userId: "user-1",
      startsAt: new Date("2026-01-05T00:00:00.000Z"),
      endsAt: new Date("2026-01-06T00:00:00.000Z"),
      phoneOverride: "+15551234567",
    });
    const useCase = buildUseCase(repository);

    const result = await useCase.execute("tenant-1", "business-1", now);

    expect(result).toEqual({ targets: ["+15551234567"], strategy: "priority_list" });
  });

  it("returns multiple targets for simultaneous_ring when several shifts overlap", async () => {
    const repository = new FakeOnCallRepository();
    repository.seedRotation({
      id: "rot-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      name: "Primary",
      strategy: "simultaneous_ring",
    });
    const now = new Date("2026-01-05T12:00:00.000Z");
    repository.seedShift({
      id: "shift-1",
      tenantId: "tenant-1",
      rotationId: "rot-1",
      userId: "user-1",
      startsAt: new Date("2026-01-05T00:00:00.000Z"),
      endsAt: new Date("2026-01-06T00:00:00.000Z"),
      phoneOverride: "+15551111111",
    });
    repository.seedShift({
      id: "shift-2",
      tenantId: "tenant-1",
      rotationId: "rot-1",
      userId: "user-2",
      startsAt: new Date("2026-01-05T00:00:00.000Z"),
      endsAt: new Date("2026-01-06T00:00:00.000Z"),
      phoneOverride: "+15552222222",
    });
    const useCase = buildUseCase(repository);

    const result = await useCase.execute("tenant-1", "business-1", now);

    expect(result.targets).toEqual(["+15551111111", "+15552222222"]);
  });

  it("falls through to the next upcoming shift when nothing is active right now", async () => {
    const repository = new FakeOnCallRepository();
    repository.seedRotation({
      id: "rot-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      name: "Primary",
      strategy: "round_robin",
    });
    const now = new Date("2026-01-05T12:00:00.000Z");
    repository.seedShift({
      id: "shift-1",
      tenantId: "tenant-1",
      rotationId: "rot-1",
      userId: "user-1",
      startsAt: new Date("2026-01-06T00:00:00.000Z"),
      endsAt: new Date("2026-01-07T00:00:00.000Z"),
      phoneOverride: "+15553333333",
    });
    const useCase = buildUseCase(repository);

    const result = await useCase.execute("tenant-1", "business-1", now);

    expect(result).toEqual({ targets: ["+15553333333"], strategy: "round_robin" });
  });

  it("returns an empty target list when an active shift has no phoneOverride (User has no phone column)", async () => {
    const repository = new FakeOnCallRepository();
    repository.seedRotation({
      id: "rot-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      name: "Primary",
      strategy: "priority_list",
    });
    const now = new Date("2026-01-05T12:00:00.000Z");
    repository.seedShift({
      id: "shift-1",
      tenantId: "tenant-1",
      rotationId: "rot-1",
      userId: "user-1",
      startsAt: new Date("2026-01-05T00:00:00.000Z"),
      endsAt: new Date("2026-01-06T00:00:00.000Z"),
      phoneOverride: null,
    });
    const useCase = buildUseCase(repository);

    const result = await useCase.execute("tenant-1", "business-1", now);

    expect(result.targets).toEqual([]);
  });
});
