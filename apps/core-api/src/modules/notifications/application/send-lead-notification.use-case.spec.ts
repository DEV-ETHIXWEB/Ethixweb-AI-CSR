import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { GetCustomerUseCase } from "../../customers/application/get-customer.use-case";
import type { GetLeadUseCase } from "../../leads/application/get-lead.use-case";
import type { NotificationChannelSender } from "../domain/ports/notification-channel-sender.port";
import type { RedisClaimMappingStore } from "../infrastructure/redis-claim-mapping.store";
import { FakeNotificationChannelRepository } from "./__fakes__/fake-notification-channel-repository";
import { FakeNotificationRepository } from "./__fakes__/fake-notification-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { ChannelSenderRegistry } from "./channel-sender-registry";
import { SendLeadNotificationUseCase } from "./send-lead-notification.use-case";

function fakeLead() {
  return {
    execute: jest.fn().mockResolvedValue({
      id: "lead-1",
      customerId: "customer-1",
      priority: "urgent",
      leadType: "residential",
      problemSummary: "Water heater leaking",
    }),
  } as unknown as GetLeadUseCase;
}

function fakeCustomer() {
  return {
    execute: jest.fn().mockResolvedValue({
      name: "Jane Doe",
      phoneE164: "+15551234567",
      address: { street: "123 Main St", city: "Chicago", state: "IL", zip: "60601" },
    }),
  } as unknown as GetCustomerUseCase;
}

function fakeSender(channelType: string, success = true) {
  const send = jest.fn().mockResolvedValue({ success, error: success ? undefined : "boom" });
  return { send, sender: { channelType, send } as unknown as NotificationChannelSender };
}

/** A sender that fails `failuresBeforeSuccess` times, then succeeds — for exercising the real retry path. */
function fakeFlakySender(channelType: string, failuresBeforeSuccess: number) {
  let calls = 0;
  const send = jest.fn().mockImplementation(() => {
    calls += 1;
    if (calls <= failuresBeforeSuccess) {
      return Promise.resolve({ success: false, error: `transient failure #${calls}` });
    }
    return Promise.resolve({ success: true });
  });
  return { send, sender: { channelType, send } as unknown as NotificationChannelSender };
}

function fakeClaimMappingStore() {
  const remember = jest.fn();
  return { remember, store: { remember, resolve: jest.fn() } as unknown as RedisClaimMappingStore };
}

describe("SendLeadNotificationUseCase", () => {
  it("fans out to every active channel and records a Notification row per channel", async () => {
    const channelRepository = new FakeNotificationChannelRepository();
    channelRepository.seed({
      id: "chan-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      channelType: "sms",
      destination: { phone: "+15559999999" },
      isActive: true,
      priorityOrder: 0,
    });
    channelRepository.seed({
      id: "chan-2",
      tenantId: "tenant-1",
      businessId: "business-1",
      channelType: "webhook",
      destination: { webhookUrl: "https://example.com/hook" },
      isActive: true,
      priorityOrder: 1,
    });
    const notificationRepository = new FakeNotificationRepository();
    const registry = new ChannelSenderRegistry();
    const sms = fakeSender("sms");
    const webhook = fakeSender("webhook");
    registry.register(sms.sender);
    registry.register(webhook.sender);
    const useCase = new SendLeadNotificationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      channelRepository,
      notificationRepository,
      registry,
      fakeLead(),
      fakeCustomer(),
      fakeClaimMappingStore().store,
      createNoopLogger(),
    );

    const outcomes = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      leadId: "lead-1",
    });

    expect(outcomes).toEqual([
      { channelType: "sms", success: true },
      { channelType: "webhook", success: true },
    ]);
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(webhook.send).toHaveBeenCalledTimes(1);
  });

  it(
    "PHASE 10 — ONE qualified lead produces ONE consolidated notification flow, not the original " +
      "HCP failure mode of independent, inconsistent fan-out texts: every channel receives content " +
      "derived from the IDENTICAL canonical payload (same customer/problem/priority/address), and a " +
      "second call for the SAME lead sends nothing further (per-channel dedup already proven above, " +
      "asserted again here specifically as the anti-duplicate-callback guarantee)",
    async () => {
      const channelRepository = new FakeNotificationChannelRepository();
      channelRepository.seed({
        id: "chan-1",
        tenantId: "tenant-1",
        businessId: "business-1",
        channelType: "sms",
        destination: { phone: "+15559999999" },
        isActive: true,
        priorityOrder: 0,
      });
      channelRepository.seed({
        id: "chan-2",
        tenantId: "tenant-1",
        businessId: "business-1",
        channelType: "webhook",
        destination: { webhookUrl: "https://example.com/hook" },
        isActive: true,
        priorityOrder: 1,
      });
      const notificationRepository = new FakeNotificationRepository();
      const registry = new ChannelSenderRegistry();
      const sms = fakeSender("sms");
      const webhook = fakeSender("webhook");
      registry.register(sms.sender);
      registry.register(webhook.sender);
      const useCase = new SendLeadNotificationUseCase(
        new FakeTenantContextService() as unknown as TenantContextService,
        channelRepository,
        notificationRepository,
        registry,
        fakeLead(),
        fakeCustomer(),
        fakeClaimMappingStore().store,
        createNoopLogger(),
      );

      await useCase.execute({ tenantId: "tenant-1", businessId: "business-1", leadId: "lead-1" });

      // Every sender was called with a payload carrying the SAME lead
      // identity, customer, problem, and priority — one canonical source
      // of truth rendered per channel, never independently-assembled,
      // potentially-drifting content per channel.
      const smsPayload = sms.send.mock.calls[0]?.[1];
      const webhookPayload = webhook.send.mock.calls[0]?.[1];
      expect(smsPayload).toMatchObject({
        leadId: "lead-1",
        customerName: "Jane Doe",
        problemSummary: "Water heater leaking",
        priority: "urgent",
      });
      expect(webhookPayload).toEqual(smsPayload);

      // Re-invoking for the SAME lead (e.g. a duplicated outbox-relay
      // poll, or a retried lead.created event) sends NOTHING further —
      // the exact anti-duplicate-callback guarantee this whole flow
      // exists to prove.
      sms.send.mockClear();
      webhook.send.mockClear();
      const secondOutcomes = await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        leadId: "lead-1",
      });
      expect(secondOutcomes).toEqual([
        { channelType: "sms", success: true },
        { channelType: "webhook", success: true },
      ]);
      expect(sms.send).not.toHaveBeenCalled();
      expect(webhook.send).not.toHaveBeenCalled();
    },
  );

  it("one channel failing does not block the others", async () => {
    const channelRepository = new FakeNotificationChannelRepository();
    channelRepository.seed({
      id: "chan-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      channelType: "sms",
      destination: { phone: "+15559999999" },
      isActive: true,
      priorityOrder: 0,
    });
    channelRepository.seed({
      id: "chan-2",
      tenantId: "tenant-1",
      businessId: "business-1",
      channelType: "webhook",
      destination: { webhookUrl: "https://example.com/hook" },
      isActive: true,
      priorityOrder: 1,
    });
    const registry = new ChannelSenderRegistry();
    registry.register(fakeSender("sms", false).sender);
    registry.register(fakeSender("webhook", true).sender);
    const useCase = new SendLeadNotificationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      channelRepository,
      new FakeNotificationRepository(),
      registry,
      fakeLead(),
      fakeCustomer(),
      fakeClaimMappingStore().store,
      createNoopLogger(),
    );

    const outcomes = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      leadId: "lead-1",
    });

    expect(outcomes[0]?.success).toBe(false);
    expect(outcomes[1]?.success).toBe(true);
  });

  it("never sends twice for the same lead+channel (dedup key), and reports it as success without re-invoking the sender", async () => {
    const channelRepository = new FakeNotificationChannelRepository();
    channelRepository.seed({
      id: "chan-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      channelType: "sms",
      destination: { phone: "+15559999999" },
      isActive: true,
      priorityOrder: 0,
    });
    const registry = new ChannelSenderRegistry();
    const sms = fakeSender("sms");
    registry.register(sms.sender);
    const notificationRepository = new FakeNotificationRepository();
    // Pre-seed as if this channel already got a successful send for this lead.
    await notificationRepository.create(undefined as never, {
      tenantId: "tenant-1",
      leadId: "lead-1",
      channelType: "sms",
      destination: "{}",
      status: "sent",
      dedupKey: "notification:lead-1:sms",
    });
    const useCase = new SendLeadNotificationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      channelRepository,
      notificationRepository,
      registry,
      fakeLead(),
      fakeCustomer(),
      fakeClaimMappingStore().store,
      createNoopLogger(),
    );

    const outcomes = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      leadId: "lead-1",
    });

    expect(outcomes).toEqual([{ channelType: "sms", success: true }]);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it("remembers a phone->lead claim mapping after a successful SMS send when the channel is tagged with a userId", async () => {
    const channelRepository = new FakeNotificationChannelRepository();
    channelRepository.seed({
      id: "chan-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      channelType: "sms",
      destination: { phone: "+15559999999", userId: "user-1" },
      isActive: true,
      priorityOrder: 0,
    });
    const registry = new ChannelSenderRegistry();
    registry.register(fakeSender("sms", true).sender);
    const claimMappingStore = fakeClaimMappingStore();
    const useCase = new SendLeadNotificationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      channelRepository,
      new FakeNotificationRepository(),
      registry,
      fakeLead(),
      fakeCustomer(),
      claimMappingStore.store,
      createNoopLogger(),
    );

    await useCase.execute({ tenantId: "tenant-1", businessId: "business-1", leadId: "lead-1" });

    expect(claimMappingStore.remember).toHaveBeenCalledWith("+15559999999", {
      tenantId: "tenant-1",
      leadId: "lead-1",
      userId: "user-1",
    });
  });

  it("does not remember a claim mapping for a channel with no configured userId", async () => {
    const channelRepository = new FakeNotificationChannelRepository();
    channelRepository.seed({
      id: "chan-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      channelType: "sms",
      destination: { phone: "+15559999999" },
      isActive: true,
      priorityOrder: 0,
    });
    const registry = new ChannelSenderRegistry();
    registry.register(fakeSender("sms", true).sender);
    const claimMappingStore = fakeClaimMappingStore();
    const useCase = new SendLeadNotificationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      channelRepository,
      new FakeNotificationRepository(),
      registry,
      fakeLead(),
      fakeCustomer(),
      claimMappingStore.store,
      createNoopLogger(),
    );

    await useCase.execute({ tenantId: "tenant-1", businessId: "business-1", leadId: "lead-1" });

    expect(claimMappingStore.remember).not.toHaveBeenCalled();
  });

  it("actually retries a sender that reports failure, and succeeds once it recovers within the retry budget", async () => {
    const channelRepository = new FakeNotificationChannelRepository();
    channelRepository.seed({
      id: "chan-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      channelType: "sms",
      destination: { phone: "+15559999999" },
      isActive: true,
      priorityOrder: 0,
    });
    const registry = new ChannelSenderRegistry();
    const flaky = fakeFlakySender("sms", 2); // fails twice, succeeds on the 3rd (last allowed) attempt
    registry.register(flaky.sender);
    const useCase = new SendLeadNotificationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      channelRepository,
      new FakeNotificationRepository(),
      registry,
      fakeLead(),
      fakeCustomer(),
      fakeClaimMappingStore().store,
      createNoopLogger(),
    );

    const outcomes = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      leadId: "lead-1",
    });

    expect(outcomes).toEqual([{ channelType: "sms", success: true }]);
    expect(flaky.send).toHaveBeenCalledTimes(3);
  }, 10000);

  it(
    "NO SILENT GAP: warns loudly when a lead has zero active notification channels configured " +
      "— found live: this used to be an indistinguishable-from-success silent no-op, meaning an " +
      "emergency-priority lead could reach zero humans with nothing anywhere saying so",
    async () => {
      const channelRepository = new FakeNotificationChannelRepository();
      // Deliberately NOT seeding any channel for this business.
      const logger = createNoopLogger();
      const warnSpy = jest.spyOn(logger, "warn");
      const useCase = new SendLeadNotificationUseCase(
        new FakeTenantContextService() as unknown as TenantContextService,
        channelRepository,
        new FakeNotificationRepository(),
        new ChannelSenderRegistry(),
        fakeLead(),
        fakeCustomer(),
        fakeClaimMappingStore().store,
        logger,
      );

      const outcomes = await useCase.execute({
        tenantId: "tenant-1",
        businessId: "business-1",
        leadId: "lead-1",
      });

      expect(outcomes).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("NO active channels"),
        expect.objectContaining({ tenantId: "tenant-1", leadId: "lead-1" }),
      );
    },
  );

  it(
    "CONNECTION-POOL SAFETY: the sender.send() call happens between two SEPARATE " +
      "tenantContext.run transactions, never nested inside one held open for its duration — " +
      "see this use case's own comment on why a single wrapping transaction would leave a real " +
      "Postgres connection held open across every sender's retry budget",
    async () => {
      const channelRepository = new FakeNotificationChannelRepository();
      channelRepository.seed({
        id: "chan-1",
        tenantId: "tenant-1",
        businessId: "business-1",
        channelType: "sms",
        destination: { phone: "+15559999999" },
        isActive: true,
        priorityOrder: 0,
      });
      const registry = new ChannelSenderRegistry();
      const sms = fakeSender("sms");
      registry.register(sms.sender);
      const tenantContext = new FakeTenantContextService() as unknown as TenantContextService;
      const useCase = new SendLeadNotificationUseCase(
        tenantContext,
        channelRepository,
        new FakeNotificationRepository(),
        registry,
        fakeLead(),
        fakeCustomer(),
        fakeClaimMappingStore().store,
        createNoopLogger(),
      );
      const events: string[] = [];
      jest.spyOn(tenantContext, "run").mockImplementation(async (_tenantId, work) => {
        events.push("run:start");
        const result = await (work as (db: never) => Promise<unknown>)({
          $executeRaw: async () => 0,
        } as never);
        events.push("run:end");
        return result;
      });
      sms.send.mockImplementation(async () => {
        events.push("send:start");
        events.push("send:end");
        return { success: true };
      });

      await useCase.execute({ tenantId: "tenant-1", businessId: "business-1", leadId: "lead-1" });

      expect(events).toEqual([
        "run:start",
        "run:end", // execute()'s own channel-list read — its own, already-closed transaction
        "run:start",
        "run:end", // reserving the Notification row (dedup check) — its own, already-closed transaction
        "send:start",
        "send:end", // the sender call — no transaction open around it at all
        "run:start",
        "run:end", // marking the notification sent — a fresh, separate transaction
      ]);
    },
  );

  it("moves a notification to dead_letter once the retry budget is exhausted, surfacing the real failure reason", async () => {
    const channelRepository = new FakeNotificationChannelRepository();
    channelRepository.seed({
      id: "chan-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      channelType: "sms",
      destination: { phone: "+15559999999" },
      isActive: true,
      priorityOrder: 0,
    });
    const registry = new ChannelSenderRegistry();
    const failing = fakeSender("sms", false);
    registry.register(failing.sender);
    const notificationRepository = new FakeNotificationRepository();
    const useCase = new SendLeadNotificationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      channelRepository,
      notificationRepository,
      registry,
      fakeLead(),
      fakeCustomer(),
      fakeClaimMappingStore().store,
      createNoopLogger(),
    );

    const outcomes = await useCase.execute({
      tenantId: "tenant-1",
      businessId: "business-1",
      leadId: "lead-1",
    });

    expect(outcomes).toEqual([{ channelType: "sms", success: false, error: "boom" }]);
    expect(failing.send).toHaveBeenCalledTimes(3);
    const history = await notificationRepository.listByLead(
      undefined as never,
      "tenant-1",
      "lead-1",
    );
    expect(history[0]?.status).toBe("dead_letter");
  }, 10000);
});
