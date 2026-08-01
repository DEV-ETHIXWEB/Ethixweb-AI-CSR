import { LeadAlreadyClaimedError } from "../../leads/domain/errors";
import type { ClaimLeadUseCase } from "../../leads/application/claim-lead.use-case";
import type { RedisClaimMappingStore } from "../infrastructure/redis-claim-mapping.store";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { HandleSmsClaimReplyUseCase } from "./handle-sms-claim-reply.use-case";

function fakeClaimMappingStore(
  mapping: { tenantId: string; leadId: string; userId: string } | null,
) {
  return {
    resolve: jest.fn().mockResolvedValue(mapping),
    remember: jest.fn(),
  } as unknown as RedisClaimMappingStore;
}

function fakeClaimLeadUseCase(behavior: "succeed" | "already_claimed" | "throw" = "succeed") {
  const execute = jest.fn();
  if (behavior === "succeed") {
    execute.mockResolvedValue({ lead: {}, claim: {} });
  } else if (behavior === "already_claimed") {
    execute.mockRejectedValue(new LeadAlreadyClaimedError("lead-1"));
  } else {
    execute.mockRejectedValue(new Error("boom"));
  }
  return { execute, useCase: { execute } as unknown as ClaimLeadUseCase };
}

describe("HandleSmsClaimReplyUseCase", () => {
  it("claims the mapped lead when the reply is exactly CLAIM (case-insensitive)", async () => {
    const claimMappingStore = fakeClaimMappingStore({
      tenantId: "tenant-1",
      leadId: "lead-1",
      userId: "user-1",
    });
    const { execute, useCase: claimLeadUseCase } = fakeClaimLeadUseCase("succeed");
    const useCase = new HandleSmsClaimReplyUseCase(
      claimMappingStore,
      claimLeadUseCase,
      createNoopLogger(),
    );

    const result = await useCase.execute("+15551234567", " claim ");

    expect(result).toEqual({ status: "claimed", leadId: "lead-1" });
    expect(execute).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      leadId: "lead-1",
      claimedByUserId: "user-1",
      claimMethod: "sms_reply",
    });
  });

  it("ignores any reply that isn't exactly CLAIM", async () => {
    const claimMappingStore = fakeClaimMappingStore({
      tenantId: "tenant-1",
      leadId: "lead-1",
      userId: "user-1",
    });
    const { execute, useCase: claimLeadUseCase } = fakeClaimLeadUseCase("succeed");
    const useCase = new HandleSmsClaimReplyUseCase(
      claimMappingStore,
      claimLeadUseCase,
      createNoopLogger(),
    );

    const result = await useCase.execute("+15551234567", "sounds good, on my way");

    expect(result).toEqual({ status: "ignored" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns no_mapping when the phone number has no remembered lead (expired or never sent)", async () => {
    const claimMappingStore = fakeClaimMappingStore(null);
    const { useCase: claimLeadUseCase } = fakeClaimLeadUseCase("succeed");
    const useCase = new HandleSmsClaimReplyUseCase(
      claimMappingStore,
      claimLeadUseCase,
      createNoopLogger(),
    );

    const result = await useCase.execute("+15551234567", "CLAIM");

    expect(result).toEqual({ status: "no_mapping" });
  });

  it("returns already_claimed when a race means someone else claimed first", async () => {
    const claimMappingStore = fakeClaimMappingStore({
      tenantId: "tenant-1",
      leadId: "lead-1",
      userId: "user-1",
    });
    const { useCase: claimLeadUseCase } = fakeClaimLeadUseCase("already_claimed");
    const useCase = new HandleSmsClaimReplyUseCase(
      claimMappingStore,
      claimLeadUseCase,
      createNoopLogger(),
    );

    const result = await useCase.execute("+15551234567", "CLAIM");

    expect(result).toEqual({ status: "already_claimed", leadId: "lead-1" });
  });

  it("propagates any other unexpected error rather than swallowing it", async () => {
    const claimMappingStore = fakeClaimMappingStore({
      tenantId: "tenant-1",
      leadId: "lead-1",
      userId: "user-1",
    });
    const { useCase: claimLeadUseCase } = fakeClaimLeadUseCase("throw");
    const useCase = new HandleSmsClaimReplyUseCase(
      claimMappingStore,
      claimLeadUseCase,
      createNoopLogger(),
    );

    await expect(useCase.execute("+15551234567", "CLAIM")).rejects.toThrow("boom");
  });
});
