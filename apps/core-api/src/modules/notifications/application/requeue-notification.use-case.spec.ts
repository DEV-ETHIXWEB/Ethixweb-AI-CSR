import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { GetCustomerUseCase } from "../../customers/application/get-customer.use-case";
import type { GetLeadUseCase } from "../../leads/application/get-lead.use-case";
import type { Notification } from "../domain/notification.entity";
import type { NotificationChannelSender } from "../domain/ports/notification-channel-sender.port";
import { NotificationNotFoundError, NotificationNotRequeueableError } from "../domain/errors";
import { FakeNotificationRepository } from "./__fakes__/fake-notification-repository";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { ChannelSenderRegistry } from "./channel-sender-registry";
import { RequeueNotificationUseCase } from "./requeue-notification.use-case";

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

function fakeSender(channelType: string, success: boolean) {
  const send = jest.fn().mockResolvedValue({ success, error: success ? undefined : "still down" });
  return { send, sender: { channelType, send } as unknown as NotificationChannelSender };
}

function deadLetteredNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-1",
    tenantId: "tenant-1",
    leadId: "lead-1",
    channelType: "sms",
    destination: JSON.stringify({ phone: "+15559999999" }),
    status: "dead_letter",
    dedupKey: "notification:lead-1:sms",
    attemptCount: 3,
    sentAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function buildUseCase(
  registry: ChannelSenderRegistry,
  notificationRepository = new FakeNotificationRepository(),
) {
  return {
    notificationRepository,
    useCase: new RequeueNotificationUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      notificationRepository,
      registry,
      fakeLead(),
      fakeCustomer(),
      createNoopLogger(),
    ),
  };
}

describe("RequeueNotificationUseCase", () => {
  it("re-sends a dead-lettered notification and marks it sent on success", async () => {
    const registry = new ChannelSenderRegistry();
    const sender = fakeSender("sms", true);
    registry.register(sender.sender);
    const notificationRepository = new FakeNotificationRepository();
    notificationRepository.seed(deadLetteredNotification());
    const { useCase } = buildUseCase(registry, notificationRepository);

    const result = await useCase.execute("tenant-1", "notif-1");

    expect(result).toEqual({ channelType: "sms", success: true });
    const updated = await notificationRepository.findById(
      undefined as never,
      "tenant-1",
      "notif-1",
    );
    expect(updated?.status).toBe("sent");
  });

  it("re-renders the payload fresh from the lead/customer rather than reusing anything stale", async () => {
    const registry = new ChannelSenderRegistry();
    const sender = fakeSender("sms", true);
    registry.register(sender.sender);
    const notificationRepository = new FakeNotificationRepository();
    notificationRepository.seed(deadLetteredNotification());
    const { useCase } = buildUseCase(registry, notificationRepository);

    await useCase.execute("tenant-1", "notif-1");

    const [, payload] = sender.send.mock.calls[0] as [unknown, { problemSummary: string }];
    expect(payload.problemSummary).toBe("Water heater leaking");
  });

  it("stays dead_letter (not thrown) when the redrive attempt fails again", async () => {
    const registry = new ChannelSenderRegistry();
    registry.register(fakeSender("sms", false).sender);
    const notificationRepository = new FakeNotificationRepository();
    notificationRepository.seed(deadLetteredNotification());
    const { useCase } = buildUseCase(registry, notificationRepository);

    const result = await useCase.execute("tenant-1", "notif-1");

    expect(result).toEqual({ channelType: "sms", success: false, error: "still down" });
    const updated = await notificationRepository.findById(
      undefined as never,
      "tenant-1",
      "notif-1",
    );
    expect(updated?.status).toBe("dead_letter");
  });

  it("throws NotificationNotFoundError for an unknown notification", async () => {
    const { useCase } = buildUseCase(new ChannelSenderRegistry());

    await expect(useCase.execute("tenant-1", "missing")).rejects.toThrow(NotificationNotFoundError);
  });

  it("throws NotificationNotRequeueableError for a notification that isn't dead_letter", async () => {
    const notificationRepository = new FakeNotificationRepository();
    notificationRepository.seed(deadLetteredNotification({ status: "sent" }));
    const { useCase } = buildUseCase(new ChannelSenderRegistry(), notificationRepository);

    await expect(useCase.execute("tenant-1", "notif-1")).rejects.toThrow(
      NotificationNotRequeueableError,
    );
  });

  it(
    "CONNECTION-POOL SAFETY: the sender.send() call happens between two SEPARATE " +
      "tenantContext.run transactions, never nested inside one held open for its duration — " +
      "see this use case's own comment on why a single wrapping transaction would leave a real " +
      "Postgres connection held open across the sender's own timeout AND a needless nested " +
      "transaction from getLeadUseCase/getCustomerUseCase",
    async () => {
      const registry = new ChannelSenderRegistry();
      const sender = fakeSender("sms", true);
      registry.register(sender.sender);
      const notificationRepository = new FakeNotificationRepository();
      notificationRepository.seed(deadLetteredNotification());
      const tenantContext = new FakeTenantContextService() as unknown as TenantContextService;
      const useCase = new RequeueNotificationUseCase(
        tenantContext,
        notificationRepository,
        registry,
        fakeLead(),
        fakeCustomer(),
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
      sender.send.mockImplementation(async () => {
        events.push("send:start");
        events.push("send:end");
        return { success: true };
      });

      await useCase.execute("tenant-1", "notif-1");

      expect(events).toEqual([
        "run:start",
        "run:end", // reading the dead-lettered notification — its own, already-closed transaction
        "send:start",
        "send:end", // the sender call — no transaction open around it at all
        "run:start",
        "run:end", // marking the notification sent — a fresh, separate transaction
      ]);
    },
  );
});
