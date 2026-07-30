import type { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { IntegrationNotFoundError, InvalidCrmWebhookSignatureError } from "../domain/errors";
import type { Integration } from "../domain/integration.entity";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeCredentialEncryptor } from "./__fakes__/fake-credential-encryptor";
import { FakeCrmAdapter } from "./__fakes__/fake-crm-adapter";
import { FakeCrmAdapterRegistry } from "./__fakes__/fake-crm-adapter-registry";
import { FakeIntegrationRepository } from "./__fakes__/fake-integration-repository";
import { FakeOutboxWriterFactory } from "./__fakes__/fake-outbox-writer-factory";
import { FakeTenantContextService } from "./__fakes__/fake-tenant-context";
import { FakeWebhookEventStore } from "./__fakes__/fake-webhook-event-store";
import { ReceiveCrmWebhookUseCase } from "./receive-crm-webhook.use-case";

const SIGNING_SECRET = "whsec_test";

function makeIntegration(): Integration {
  return {
    id: "integration-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    crmType: "fake",
    authType: "api_key",
    config: {},
    status: "active",
    lastVerifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildUseCase(integrationRepository: FakeIntegrationRepository, adapter: FakeCrmAdapter) {
  const webhookEventStore = new FakeWebhookEventStore();
  const outboxWriterFactory = new FakeOutboxWriterFactory();
  return {
    useCase: new ReceiveCrmWebhookUseCase(
      new FakeTenantContextService() as unknown as TenantContextService,
      integrationRepository,
      new FakeCrmAdapterRegistry({ fake: adapter }),
      webhookEventStore,
      outboxWriterFactory,
      createNoopLogger(),
    ),
    webhookEventStore,
    outboxWriterFactory,
  };
}

describe("ReceiveCrmWebhookUseCase", () => {
  it("accepts a validly-signed, new event and publishes it to the outbox", async () => {
    const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await integrationRepository.seed(makeIntegration(), {
      type: "api_key",
      apiKey: "k",
      webhookSigningSecret: SIGNING_SECRET,
    });
    const { useCase, outboxWriterFactory } = buildUseCase(
      integrationRepository,
      new FakeCrmAdapter(),
    );

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        integrationId: "integration-1",
        crmType: "fake",
        headers: {},
        rawBody: JSON.stringify({
          eventId: "evt-1",
          eventType: "lead.created",
          secret: SIGNING_SECRET,
        }),
      }),
    ).resolves.toBeUndefined();
    expect(outboxWriterFactory.writtenEvents).toHaveLength(1);
    expect(outboxWriterFactory.writtenEvents[0]?.eventType).toBe("crm.fake.lead.created");
  });

  it("rejects a payload whose signature doesn't verify, and publishes nothing", async () => {
    const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await integrationRepository.seed(makeIntegration(), {
      type: "api_key",
      apiKey: "k",
      webhookSigningSecret: SIGNING_SECRET,
    });
    const { useCase, outboxWriterFactory } = buildUseCase(
      integrationRepository,
      new FakeCrmAdapter(),
    );

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        integrationId: "integration-1",
        crmType: "fake",
        headers: {},
        rawBody: JSON.stringify({ eventId: "evt-1", eventType: "lead.created" }), // no secret embedded
      }),
    ).rejects.toThrow(InvalidCrmWebhookSignatureError);
    expect(outboxWriterFactory.writtenEvents).toHaveLength(0);
  });

  it("throws IntegrationNotFoundError when the URL's crmType doesn't match the stored integration", async () => {
    const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await integrationRepository.seed(makeIntegration(), {
      type: "api_key",
      apiKey: "k",
      webhookSigningSecret: SIGNING_SECRET,
    });
    const { useCase } = buildUseCase(integrationRepository, new FakeCrmAdapter());

    await expect(
      useCase.execute({
        tenantId: "tenant-1",
        integrationId: "integration-1",
        crmType: "housecall_pro", // mismatched
        headers: {},
        rawBody: JSON.stringify({
          eventId: "evt-1",
          eventType: "lead.created",
          secret: SIGNING_SECRET,
        }),
      }),
    ).rejects.toThrow(IntegrationNotFoundError);
  });

  it("processes a redelivery of the same event idempotently (no error, no duplicate outbox publish)", async () => {
    const integrationRepository = new FakeIntegrationRepository(new FakeCredentialEncryptor());
    await integrationRepository.seed(makeIntegration(), {
      type: "api_key",
      apiKey: "k",
      webhookSigningSecret: SIGNING_SECRET,
    });
    const { useCase, outboxWriterFactory } = buildUseCase(
      integrationRepository,
      new FakeCrmAdapter(),
    );
    const command = {
      tenantId: "tenant-1",
      integrationId: "integration-1",
      crmType: "fake",
      headers: {},
      rawBody: JSON.stringify({
        eventId: "evt-redelivered",
        eventType: "lead.created",
        secret: SIGNING_SECRET,
      }),
    };

    await useCase.execute(command); // first delivery
    await expect(useCase.execute(command)).resolves.toBeUndefined(); // redelivery — still succeeds, not an error
    expect(outboxWriterFactory.writtenEvents).toHaveLength(1); // never published twice
  });
});
