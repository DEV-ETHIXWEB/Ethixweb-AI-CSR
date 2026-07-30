import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import {
  OUTBOX_WRITER_FACTORY,
  type OutboxWriterFactory,
} from "../../../shared/outbox/outbox-writer-factory";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import {
  WEBHOOK_EVENT_STORE,
  type WebhookEventStore,
} from "../../../shared/webhooks/webhook-event-store";
import {
  CrmAdapterError,
  IntegrationNotFoundError,
  InvalidCrmWebhookSignatureError,
} from "../domain/errors";
import {
  CRM_ADAPTER_REGISTRY,
  type CrmAdapterRegistry,
} from "../domain/ports/crm-adapter-registry.port";
import {
  INTEGRATION_REPOSITORY,
  type IntegrationRepository,
} from "../domain/ports/integration-repository.port";

export interface ReceiveCrmWebhookCommand {
  tenantId: string;
  integrationId: string;
  crmType: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}

/**
 * Verify -> dedup -> normalize -> hand off. This use-case's job stops at
 * publishing a normalized domain event to the outbox — actually updating a
 * local `leads.status` on `lead.converted`, for example, is Lead Management
 * module territory (per this session's module roadmap), a downstream
 * consumer of the same event this writes, not built here.
 *
 * `tenantId` and `integrationId` both come from the webhook URL path
 * (docs/05 §2.6: the receiving URL is entered once, manually, at CRM-side
 * webhook setup) — deliberately not resolved from an RLS-bypassing lookup
 * the way auth's API-key authentication needed (docs/20 ADR-015): unlike a
 * bearer credential a human client presents on every call, a webhook URL is
 * chosen once, at connect time, so it can simply encode both ids directly.
 * The signature check below is the actual authentication — the URL ids are
 * a routing hint, not a trust boundary on their own.
 */
@Injectable()
export class ReceiveCrmWebhookUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
    @Inject(CRM_ADAPTER_REGISTRY) private readonly adapterRegistry: CrmAdapterRegistry,
    @Inject(WEBHOOK_EVENT_STORE) private readonly webhookEventStore: WebhookEventStore,
    @Inject(OUTBOX_WRITER_FACTORY) private readonly outboxWriterFactory: OutboxWriterFactory,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: ReceiveCrmWebhookCommand): Promise<void> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.integration_id": command.integrationId,
    });

    await this.tenantContext.run(command.tenantId, async (db) => {
      const integration = await this.integrationRepository.findById(
        db,
        command.tenantId,
        command.integrationId,
      );
      if (!integration || integration.crmType !== command.crmType) {
        // Same error either way: a mismatched crmType in the URL shouldn't
        // confirm to a caller which integrations exist under a given id.
        throw new IntegrationNotFoundError(command.integrationId);
      }

      const credential = await this.integrationRepository.getDecryptedCredential(
        db,
        command.tenantId,
        command.integrationId,
      );
      const signingSecret = credential.webhookSigningSecret;
      if (!signingSecret) {
        throw new CrmAdapterError(
          integration.crmType,
          "receiveWebhook",
          "no webhook signing secret configured for this integration",
        );
      }

      const adapter = this.adapterRegistry.resolve(integration.crmType, command.tenantId);
      const isValidSignature = adapter.verifyWebhookSignature(
        command.headers,
        command.rawBody,
        signingSecret,
      );
      if (!isValidSignature) {
        throw new InvalidCrmWebhookSignatureError(integration.crmType);
      }

      const event = adapter.parseWebhookEvent(command.rawBody);
      const isNew = await this.webhookEventStore.recordIfNew(
        db,
        integration.crmType,
        event.eventId,
        event.raw,
        command.tenantId,
      );
      if (!isNew) {
        this.logger.info("CRM webhook redelivery ignored (already processed)", {
          tenantId: command.tenantId,
          integrationId: command.integrationId,
          eventType: event.eventType,
        });
        return;
      }

      const outboxWriter = this.outboxWriterFactory.forDb(db);
      await outboxWriter.write({
        tenantId: command.tenantId,
        aggregateType: "crm_lead",
        aggregateId: event.crmLeadId ?? command.integrationId,
        eventType: `crm.${integration.crmType}.${event.eventType}`,
        payload: event.raw,
        dedupKey: `${integration.crmType}:${event.eventId}`,
      });

      this.logger.info("CRM webhook received and published to outbox", {
        tenantId: command.tenantId,
        integrationId: command.integrationId,
        eventType: event.eventType,
      });
    });
  }
}
