import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { FakeEmergencyRuleRepository } from "./__fakes__/fake-emergency-rule-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { EscalateEmergencyUseCase } from "./escalate-emergency.use-case";

function buildUseCase(repository = new FakeEmergencyRuleRepository()) {
  return new EscalateEmergencyUseCase(
    new FakeTenantContextService() as unknown as TenantContextService,
    repository,
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
    });
  });
});
