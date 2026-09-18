import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeOnCallRepository } from "./__fakes__/fake-oncall-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { ResolveOnCallUseCase } from "./resolve-oncall.use-case";
import { TransferToHumanUseCase } from "./transfer-to-human.use-case";

function buildUseCase(onCallRepository = new FakeOnCallRepository()) {
  return new TransferToHumanUseCase(
    new ResolveOnCallUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      onCallRepository,
    ),
    createNoopLogger(),
  );
}

describe("TransferToHumanUseCase", () => {
  it("resolves the currently on-call target's phone number for a caller-requested handoff", async () => {
    const onCallRepository = new FakeOnCallRepository();
    onCallRepository.seedRotation({
      id: "rot-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      name: "Primary",
      strategy: "priority_list",
    });
    onCallRepository.seedShift({
      id: "shift-1",
      tenantId: "tenant-1",
      rotationId: "rot-1",
      userId: "user-1",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60_000),
      phoneOverride: "+15559876543",
    });
    const useCase = buildUseCase(onCallRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      reason: "caller_requested",
      summary: "Akash, kitchen sink leak, asked for a human directly.",
    });

    expect(result.transferDestination).toBe("+15559876543");
  });

  it("resolves to null (not an error) when no on-call rotation is configured at all", async () => {
    const useCase = buildUseCase();

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      reason: "cannot_help",
      summary: "Caller asked something outside scope.",
    });

    expect(result).toEqual({ transferDestination: null });
  });

  it("resolves to null (not a thrown error) when on-call resolution itself fails — a lookup failure must never block the handoff signal", async () => {
    const onCallRepository = new FakeOnCallRepository();
    jest
      .spyOn(onCallRepository, "listRotationsByBusiness")
      .mockRejectedValue(new Error("db down"));
    const useCase = buildUseCase(onCallRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      reason: "caller_frustrated",
      summary: "Caller frustrated after repeated misunderstanding.",
    });

    expect(result).toEqual({ transferDestination: null });
  });
});
