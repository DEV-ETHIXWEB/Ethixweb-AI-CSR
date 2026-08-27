import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { FakeEmergencyRuleRepository } from "./__fakes__/fake-emergency-rule-repository";
import { FakeOnCallRepository } from "./__fakes__/fake-oncall-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { EscalateEmergencyUseCase } from "./escalate-emergency.use-case";
import { ResolveOnCallUseCase } from "./resolve-oncall.use-case";

function buildUseCase(
  repository = new FakeEmergencyRuleRepository(),
  onCallRepository = new FakeOnCallRepository(),
) {
  const tenantContext = new FakeTenantContextService() as unknown as TenantContextService;
  return new EscalateEmergencyUseCase(
    tenantContext,
    repository,
    new ResolveOnCallUseCase(tenantContext, onCallRepository),
  );
}

describe("EscalateEmergencyUseCase", () => {
  it("matches a default keyword when the business has no configured rules of its own", async () => {
    const useCase = buildUseCase();

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "there's a burst pipe in the basement",
    });

    expect(result).toEqual({
      isEmergency: true,
      severity: "critical",
      action: "forward_call",
      matchedPattern: "burst pipe",
      transferTargets: [],
    });
  });

  it("returns a routine standard_lead result when nothing matches", async () => {
    const useCase = buildUseCase();

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "my kitchen faucet drips a little",
    });

    expect(result).toEqual({
      isEmergency: false,
      severity: "medium",
      action: "standard_lead",
      matchedPattern: null,
      transferTargets: [],
    });
  });

  it("prefers the business's OWN configured rules over the platform defaults once any exist", async () => {
    const repository = new FakeEmergencyRuleRepository();
    repository.seed({
      id: "rule-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      keywordOrPattern: "ac out",
      severity: "critical",
      escalationAction: "forward_call",
      isActive: true,
    });
    const useCase = buildUseCase(repository);

    // A default-list phrase ("burst pipe") must NOT match once the
    // business has its own rule set — only "ac out" should.
    const burstPipeResult = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "burst pipe everywhere",
    });
    const acResult = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "the ac out again",
    });

    expect(burstPipeResult.isEmergency).toBe(false);
    expect(acResult).toEqual({
      isEmergency: true,
      severity: "critical",
      action: "forward_call",
      matchedPattern: "ac out",
      transferTargets: [],
    });
  });

  it("also checks detectedKeywords, not just the free-text description", async () => {
    const useCase = buildUseCase();

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "not sure what's going on",
      detectedKeywords: ["gas leak"],
    });

    expect(result.isEmergency).toBe(true);
  });

  it("FAIL-SAFE: an unexpected repository error still escalates (priority_notify), never silently downgrades to routine", async () => {
    const repository = new FakeEmergencyRuleRepository();
    jest.spyOn(repository, "listActiveByBusiness").mockRejectedValue(new Error("db down"));
    const useCase = buildUseCase(repository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "anything at all",
    });

    expect(result).toEqual({
      isEmergency: true,
      severity: "medium",
      action: "priority_notify",
      matchedPattern: null,
      transferTargets: [],
    });
  });

  it("resolves on-call transfer targets when the action is forward_call", async () => {
    const onCallRepository = new FakeOnCallRepository();
    onCallRepository.seedRotation({
      id: "rotation-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      name: "Primary",
      strategy: "priority_list",
    });
    onCallRepository.seedShift({
      id: "shift-1",
      tenantId: "tenant-1",
      rotationId: "rotation-1",
      userId: "user-1",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60_000),
      phoneOverride: "+15551234567",
    });
    const useCase = buildUseCase(new FakeEmergencyRuleRepository(), onCallRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "gas leak in the kitchen",
    });

    expect(result.action).toBe("forward_call");
    expect(result.transferTargets).toEqual(["+15551234567"]);
  });

  it("does not resolve on-call targets for non-forward_call actions", async () => {
    const onCallRepository = new FakeOnCallRepository();
    const resolveSpy = jest.spyOn(onCallRepository, "listRotationsByBusiness");
    const useCase = buildUseCase(new FakeEmergencyRuleRepository(), onCallRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "my kitchen faucet drips a little",
    });

    expect(result.action).toBe("standard_lead");
    expect(result.transferTargets).toEqual([]);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("fails safe to empty transferTargets (not a thrown error) when on-call resolution itself fails", async () => {
    const onCallRepository = new FakeOnCallRepository();
    jest.spyOn(onCallRepository, "listRotationsByBusiness").mockRejectedValue(new Error("db down"));
    const useCase = buildUseCase(new FakeEmergencyRuleRepository(), onCallRepository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "gas leak in the kitchen",
    });

    expect(result.action).toBe("forward_call");
    expect(result.transferTargets).toEqual([]);
  });
});
