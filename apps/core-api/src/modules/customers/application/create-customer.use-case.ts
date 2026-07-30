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
import { CustomerCacheUpserter } from "./customer-cache-upserter";

export interface CreateCustomerCommand {
  tenantId: string;
  businessId: string;
  name: string;
  phoneE164: string;
  email?: string | undefined;
  address?: Record<string, unknown> | undefined;
}

/**
 * docs/13-implementation-backlog.md `customers` module §4: "CRM adapter
 * create → local unique-constraint race handling (catch constraint
 * violation, re-fetch, return existing) → cache write-back." Per
 * docs/05-crm-integration.md §2.8/§4: Housecall Pro itself has no
 * create-time duplicate prevention, so two concurrent calls for the same
 * phone number can each create a DIFFERENT remote CRM customer record —
 * an accepted tradeoff docs/05 §4 documents explicitly ("the DB UNIQUE
 * constraint is the final backstop even if the CRM itself doesn't dedup
 * server-side"). This use-case's job is protecting the LOCAL cache's
 * integrity, not preventing every possible CRM-side duplicate.
 */
@Injectable()
export class CreateCustomerUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CRM_CUSTOMER_SYNC_PORT) private readonly crmCustomerSyncPort: CrmCustomerSyncPort,
    @Inject(OUTBOX_WRITER_FACTORY) private readonly outboxWriterFactory: OutboxWriterFactory,
    private readonly cacheUpserter: CustomerCacheUpserter,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: CreateCustomerCommand): Promise<Customer> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    return this.tenantContext.run(command.tenantId, async (db) => {
      const integrationId = await this.crmCustomerSyncPort.resolveActiveIntegrationId(
        command.tenantId,
        command.businessId,
      );
      if (!integrationId) {
        throw new NoCrmIntegrationConfiguredError(command.businessId);
      }

      const crmResult = await this.crmCustomerSyncPort.createCustomer(
        command.tenantId,
        integrationId,
        { name: command.name, phoneE164: command.phoneE164, email: command.email },
      );

      const { customer, created } = await this.cacheUpserter.upsert(db, {
        tenantId: command.tenantId,
        businessId: command.businessId,
        phoneE164: command.phoneE164,
        name: crmResult.name,
        email: crmResult.email,
        address: command.address,
        crmCustomerId: crmResult.crmCustomerId,
        crmRawCache: crmResult.raw,
      });

      if (created) {
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
        this.logger.info("customer created", {
          tenantId: customer.tenantId,
          businessId: customer.businessId,
          customerId: customer.id,
        });
      } else {
        this.logger.info(
          "customer creation raced with a concurrent call — returned the existing row",
          {
            tenantId: customer.tenantId,
            businessId: customer.businessId,
            customerId: customer.id,
          },
        );
      }

      return customer;
    });
  }
}
