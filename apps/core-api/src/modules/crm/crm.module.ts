import { Module } from "@nestjs/common";
import { CircuitBreakerRegistry, RedisIdempotencyStore } from "@ethixweb/shared-kernel";
import { CRM_CUSTOMER_SYNC_PORT } from "../customers/domain/ports/crm-customer-sync.port";
import { CRM_LEAD_SYNC_PORT } from "../leads/domain/ports/crm-lead-sync.port";
import { IDEMPOTENCY_STORE } from "../../shared/idempotency/idempotency-store.token";
import { OUTBOX_WRITER_FACTORY } from "../../shared/outbox/outbox-writer-factory";
import { PrismaOutboxWriterFactory } from "../../shared/outbox/prisma-outbox-writer-factory";
import { RedisService } from "../../shared/redis/redis.service";
import { WEBHOOK_EVENT_STORE } from "../../shared/webhooks/webhook-event-store";
import { PrismaWebhookEventStore } from "../../shared/webhooks/prisma-webhook-event.store";
import { ConnectIntegrationUseCase } from "./application/connect-integration.use-case";
import { CrmCustomerSyncAdapter } from "./application/crm-customer-sync.adapter";
import { CrmLeadSyncAdapter } from "./application/crm-lead-sync.adapter";
import { CreateCustomerUseCase } from "./application/create-customer.use-case";
import { CreateLeadUseCase } from "./application/create-lead.use-case";
import { DisconnectIntegrationUseCase } from "./application/disconnect-integration.use-case";
import { GetIntegrationUseCase } from "./application/get-integration.use-case";
import { ListIntegrationsUseCase } from "./application/list-integrations.use-case";
import { ReceiveCrmWebhookUseCase } from "./application/receive-crm-webhook.use-case";
import { SearchCustomerUseCase } from "./application/search-customer.use-case";
import { VerifyIntegrationUseCase } from "./application/verify-integration.use-case";
import { CRM_ADAPTER_REGISTRY } from "./domain/ports/crm-adapter-registry.port";
import { CREDENTIAL_ENCRYPTOR } from "./domain/ports/credential-encryptor.port";
import { CRM_SYNC_LOG_REPOSITORY } from "./domain/ports/crm-sync-log-repository.port";
import { INTEGRATION_REPOSITORY } from "./domain/ports/integration-repository.port";
import { FieldEdgeAdapter } from "./infrastructure/adapters/field-edge.adapter";
import { HousecallProAdapter } from "./infrastructure/adapters/housecall-pro.adapter";
import { JobberAdapter } from "./infrastructure/adapters/jobber.adapter";
import { ServiceFusionAdapter } from "./infrastructure/adapters/service-fusion.adapter";
import { ServiceTitanAdapter } from "./infrastructure/adapters/service-titan.adapter";
import { AesGcmCredentialEncryptor } from "./infrastructure/aes-gcm-credential-encryptor";
import { CIRCUIT_BREAKER_REGISTRY } from "./infrastructure/circuit-breaker-registry.token";
import { CrmAdapterRegistryImpl } from "./infrastructure/crm-adapter-registry";
import { PrismaCrmSyncLogRepository } from "./infrastructure/prisma-crm-sync-log.repository";
import { PrismaIntegrationRepository } from "./infrastructure/prisma-integration.repository";
import { CrmSyncController } from "./interfaces/crm-sync.controller";
import { CrmWebhooksController } from "./interfaces/crm-webhooks.controller";
import { IntegrationsController } from "./interfaces/integrations.controller";

@Module({
  controllers: [IntegrationsController, CrmSyncController, CrmWebhooksController],
  providers: [
    { provide: INTEGRATION_REPOSITORY, useClass: PrismaIntegrationRepository },
    { provide: CRM_SYNC_LOG_REPOSITORY, useClass: PrismaCrmSyncLogRepository },
    { provide: CREDENTIAL_ENCRYPTOR, useClass: AesGcmCredentialEncryptor },
    { provide: WEBHOOK_EVENT_STORE, useClass: PrismaWebhookEventStore },
    { provide: OUTBOX_WRITER_FACTORY, useClass: PrismaOutboxWriterFactory },
    {
      provide: IDEMPOTENCY_STORE,
      useFactory: (redis: RedisService) => new RedisIdempotencyStore(redis),
      inject: [RedisService],
    },
    // One CircuitBreakerRegistry instance per process — shared-kernel's own
    // class, not re-derived here — keyed per (crmType, tenant) by
    // CrmAdapterRegistryImpl at resolve() time.
    { provide: CIRCUIT_BREAKER_REGISTRY, useValue: new CircuitBreakerRegistry() },
    HousecallProAdapter,
    ServiceTitanAdapter,
    JobberAdapter,
    ServiceFusionAdapter,
    FieldEdgeAdapter,
    { provide: CRM_ADAPTER_REGISTRY, useClass: CrmAdapterRegistryImpl },
    ConnectIntegrationUseCase,
    VerifyIntegrationUseCase,
    GetIntegrationUseCase,
    ListIntegrationsUseCase,
    DisconnectIntegrationUseCase,
    SearchCustomerUseCase,
    CreateCustomerUseCase,
    CreateLeadUseCase,
    ReceiveCrmWebhookUseCase,
    CrmCustomerSyncAdapter,
    { provide: CRM_CUSTOMER_SYNC_PORT, useExisting: CrmCustomerSyncAdapter },
    CrmLeadSyncAdapter,
    { provide: CRM_LEAD_SYNC_PORT, useExisting: CrmLeadSyncAdapter },
  ],
  exports: [CRM_CUSTOMER_SYNC_PORT, CRM_LEAD_SYNC_PORT],
})
export class CrmModule {}
