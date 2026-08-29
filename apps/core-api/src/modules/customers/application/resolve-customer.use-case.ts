import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import {
  OUTBOX_WRITER_FACTORY,
  type OutboxWriterFactory,
} from "../../../shared/outbox/outbox-writer-factory";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Customer } from "../domain/customer.entity";
import { NoCrmIntegrationConfiguredError } from "../domain/errors";
import {
  CRM_CUSTOMER_SYNC_PORT,
  type CrmCustomerSyncPort,
} from "../domain/ports/crm-customer-sync.port";
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepository,
  type Db,
} from "../domain/ports/customer-repository.port";
import { CustomerCacheUpserter } from "./customer-cache-upserter";

export interface ResolveCustomerCommand {
  tenantId: string;
  businessId: string;
  phoneE164: string;
}

/** docs/06's own annotation on `customers.crm_raw_cache`: "refreshed on read with a TTL." No specific number is documented — 5 minutes is a reasonable default for Phase 1's call volume, not a load-bearing constant. */
export const CUSTOMER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * docs/13-implementation-backlog.md `customers` module §3: "local cache
 * check → CRM adapter search → cache write-back." This is the first tool
 * call on every inbound call (docs/05-crm-integration.md §4) in the
 * eventual Voice AI module — not built here, but this use-case is exactly
 * the seam it will call through.
 *
 * DELIBERATELY three separate steps, not one `tenantContext.run` wrapping
 * everything — found live, not hypothetical, by re-reading this class
 * after fixing an unrelated bug: `tenantContext.run` holds open a REAL
 * Postgres interactive transaction (TenantContextService's own comment —
 * `this.prisma.$transaction`) for as long as its callback runs. The CRM
 * search below goes through ResilientCrmAdapter's circuit-breaker + retry
 * (shared-kernel's own default: up to 6 attempts, exponential backoff to a
 * 64s cap) — a degraded/slow CRM could hold that transaction open for
 * 60-90+ seconds. This runs on EVERY inbound call's first tool invocation,
 * so under concurrent load during a CRM outage, transactions this long
 * would exhaust the connection pool platform-wide (prisma.service.ts's own
 * comment documents the SAME class of exhaustion already found once, for a
 * different cause — burst volume, not per-transaction duration; fixed
 * there by raising the pool to 30, which does nothing for a transaction
 * held open for a minute+). `CreateLeadUseCase` already gets this right
 * (its own CRM sync deliberately runs outside `tenantContext.run` too) —
 * this brings `ResolveCustomerUseCase` in line with that same discipline.
 * The local cache read and the cache write-back each still need their own
 * (short-lived) transaction for RLS scoping; nothing here needs both DB
 * operations to share ONE transaction, since nothing atomicity-relevant
 * spans the read and the write in the first place.
 */
@Injectable()
export class ResolveCustomerUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CUSTOMER_REPOSITORY) private readonly customerRepository: CustomerRepository,
    @Inject(CRM_CUSTOMER_SYNC_PORT) private readonly crmCustomerSyncPort: CrmCustomerSyncPort,
    @Inject(OUTBOX_WRITER_FACTORY) private readonly outboxWriterFactory: OutboxWriterFactory,
    private readonly cacheUpserter: CustomerCacheUpserter,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: ResolveCustomerCommand): Promise<Customer | null> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    const cached = await this.tenantContext.run(command.tenantId, (db) =>
      this.customerRepository.findByPhone(
        db,
        command.tenantId,
        command.businessId,
        command.phoneE164,
      ),
    );
    if (cached && this.isFresh(cached)) {
      return cached;
    }

    const integrationId = await this.crmCustomerSyncPort.resolveActiveIntegrationId(
      command.tenantId,
      command.businessId,
    );
    if (!integrationId) {
      // No CRM connected to refresh against — stale local data beats no
      // data at all; only a genuine cache miss with no CRM is an error.
      if (cached) {
        return cached;
      }
      throw new NoCrmIntegrationConfiguredError(command.businessId);
    }

    const crmResult = await this.crmCustomerSyncPort.searchCustomer(
      command.tenantId,
      integrationId,
      command.phoneE164,
    );
    if (!crmResult) {
      return null;
    }

    return this.tenantContext.run(command.tenantId, async (db) => {
      if (cached) {
        const refreshed = await this.customerRepository.updateCrmCache(
          db,
          command.tenantId,
          cached.id,
          {
            crmCustomerId: crmResult.crmCustomerId,
            name: crmResult.name,
            email: crmResult.email,
            crmRawCache: crmResult.raw,
          },
        );
        this.logger.info("customer cache refreshed from CRM (stale TTL)", {
          tenantId: command.tenantId,
          businessId: command.businessId,
          customerId: refreshed.id,
        });
        return refreshed;
      }

      const { customer, created } = await this.cacheUpserter.upsert(db, {
        tenantId: command.tenantId,
        businessId: command.businessId,
        phoneE164: command.phoneE164,
        name: crmResult.name,
        email: crmResult.email,
        crmCustomerId: crmResult.crmCustomerId,
        crmRawCache: crmResult.raw,
      });

      if (created) {
        await this.publishCustomerCreated(db, customer);
      }
      return customer;
    });
  }

  private isFresh(customer: Customer): boolean {
    return Date.now() - customer.updatedAt.getTime() < CUSTOMER_CACHE_TTL_MS;
  }

  private async publishCustomerCreated(db: Db, customer: Customer): Promise<void> {
    await this.outboxWriterFactory.forDb(db).write({
      tenantId: customer.tenantId,
      aggregateType: "customer",
      aggregateId: customer.id,
      eventType: "customer.created",
      payload: {
        customerId: customer.id,
        businessId: customer.businessId,
        phoneE164: customer.phoneE164,
      },
      dedupKey: `customer.created:${customer.id}`,
    });
    this.logger.info("customer cached from CRM search", {
      tenantId: customer.tenantId,
      businessId: customer.businessId,
      customerId: customer.id,
    });
  }
}
