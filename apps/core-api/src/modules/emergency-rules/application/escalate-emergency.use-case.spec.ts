import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeEmergencyRuleRepository } from "./__fakes__/fake-emergency-rule-repository";
import { FakeOnCallRepository } from "./__fakes__/fake-oncall-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { EscalateEmergencyUseCase } from "./escalate-emergency.use-case";
import { ResolveOnCallUseCase } from "./resolve-oncall.use-case";

function buildUseCase(
  repository = new FakeEmergencyRuleRepository(),
  onCallRepository = new FakeOnCallRepository(),
) {
  return new EscalateEmergencyUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    repository,
    new ResolveOnCallUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      onCallRepository,
    ),
    createNoopLogger(),
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
      transferDestination: null,
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
      transferDestination: null,
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
      transferDestination: null,
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
      transferDestination: null,
    });
  });

  describe("on-call resolution for forward_call escalations", () => {
    /**
     * Regression coverage for a real gap found live while tracing the
     * complete emergency-escalation path: ResolveOnCallUseCase was fully
     * built and tested but never actually called from anywhere — a
     * forward_call escalation carried no real, currently-on-call phone
     * number at all, only a static env-var fallback the Voice Runtime
     * supplied on its own. These tests exercise the wiring this fix adds.
     */
    it("resolves the currently on-call target's phone number when a rule decides forward_call", async () => {
      const emergencyRuleRepository = new FakeEmergencyRuleRepository();
      emergencyRuleRepository.seed({
        id: "rule-1",
        tenantId: "tenant-1",
        businessId: "business-1",
        keywordOrPattern: "gas leak",
        severity: "critical",
        escalationAction: "forward_call",
        isActive: true,
      });
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
      const useCase = buildUseCase(emergencyRuleRepository, onCallRepository);

      const result = await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        description: "there's a gas leak",
      });

      expect(result.action).toBe("forward_call");
      expect(result.transferDestination).toBe("+15559876543");
    });

    it("resolves to null (not an error) when forward_call is decided but no on-call rotation is configured at all", async () => {
      const useCase = buildUseCase(); // default repos: default keyword match, no on-call rotation seeded

      const result = await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        description: "there's a burst pipe in the basement",
      });

      expect(result.action).toBe("forward_call");
      expect(result.transferDestination).toBeNull();
    });

    it("resolves to null (not a thrown error) when on-call resolution itself fails — the escalation decision must never be blocked by it", async () => {
      const onCallRepository = new FakeOnCallRepository();
      jest
        .spyOn(onCallRepository, "listRotationsByBusiness")
        .mockRejectedValue(new Error("db down"));
      const useCase = buildUseCase(new FakeEmergencyRuleRepository(), onCallRepository);

      const result = await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        description: "there's a burst pipe in the basement",
      });

      expect(result.isEmergency).toBe(true);
      expect(result.action).toBe("forward_call");
      expect(result.transferDestination).toBeNull();
    });

    it("does NOT attempt on-call resolution for a non-forward_call action (standard_lead)", async () => {
      const onCallRepository = new FakeOnCallRepository();
      const resolveSpy = jest.spyOn(onCallRepository, "listRotationsByBusiness");
      const useCase = buildUseCase(new FakeEmergencyRuleRepository(), onCallRepository);

      await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        callId: "call-1",
        description: "my kitchen faucet drips a little",
      });

      expect(resolveSpy).not.toHaveBeenCalled();
    });
  });
});
