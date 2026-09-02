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

  it("checks the business's OWN configured rules FIRST, but still falls back to platform defaults when nothing configured matches", async () => {
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

    // Regression coverage for a real production risk found live: this
    // used to return isEmergency: false for "burst pipe everywhere" here,
    // because the OLD code treated "the business has ANY configured
    // rules" as a reason to stop checking defaults entirely — meaning a
    // business with even one narrow custom rule silently lost every
    // other default emergency pattern (gas leak, flooding, sewage
    // backup, ...) the moment that one rule was added. Defaults are now
    // always checked as a floor, never silently disabled by unrelated
    // custom rules.
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

    expect(burstPipeResult).toEqual({
      isEmergency: true,
      severity: "critical",
      action: "forward_call",
      matchedPattern: "burst pipe",
      transferDestination: null,
    });
    expect(acResult).toEqual({
      isEmergency: true,
      severity: "critical",
      action: "forward_call",
      matchedPattern: "ac out",
      transferDestination: null,
    });
  });

  it("a configured rule's severity/action wins over a default's when BOTH match the same description", async () => {
    const repository = new FakeEmergencyRuleRepository();
    repository.seed({
      id: "rule-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      // Same phrase as a real default pattern, but this business has
      // decided it's only worth a priority_notify, not a full transfer.
      keywordOrPattern: "burst pipe",
      severity: "medium",
      escalationAction: "priority_notify",
      isActive: true,
    });
    const useCase = buildUseCase(repository);

    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "there's a burst pipe in the hallway",
    });

    expect(result).toEqual({
      isEmergency: true,
      severity: "medium",
      action: "priority_notify",
      matchedPattern: "burst pipe",
      transferDestination: null,
    });
  });

  it("matches regardless of word order — a caller's own phrasing, not the exact configured string", async () => {
    const repository = new FakeEmergencyRuleRepository();
    repository.seed({
      id: "rule-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      keywordOrPattern: "burst pipe",
      severity: "critical",
      escalationAction: "forward_call",
      isActive: true,
    });
    const useCase = buildUseCase(repository);

    // Regression coverage for a real production incident found live: a
    // caller saying "a pipe burst in my basement and it's flooding fast"
    // (word order reversed from the configured "burst pipe" pattern)
    // returned isEmergency: false under the old plain-substring matcher.
    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "there's water everywhere, a pipe burst in my basement and it's flooding fast",
    });

    expect(result.isEmergency).toBe(true);
    expect(result.action).toBe("forward_call");
  });

  it("does NOT false-positive on a short pattern appearing inside an unrelated word (whole-word matching)", async () => {
    const useCase = buildUseCase();

    // "gas" is a real default keyword fragment (via "gas leak"/"smell
    // gas") — a caller mentioning an unrelated word containing "gas" as a
    // substring must not trigger it.
    const result = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      callId: "call-1",
      description: "I need a new gasket for my kitchen faucet, it's dripping a little",
    });

    expect(result.isEmergency).toBe(false);
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
