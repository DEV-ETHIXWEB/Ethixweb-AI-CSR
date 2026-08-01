import { Module } from "@nestjs/common";
import { CrmModule } from "../crm/crm.module";
import { CUSTOMER_LOOKUP_PORT } from "../leads/domain/ports/customer-lookup.port";
import { OUTBOX_WRITER_FACTORY } from "../../shared/outbox/outbox-writer-factory";
import { PrismaOutboxWriterFactory } from "../../shared/outbox/prisma-outbox-writer-factory";
import { CreateCustomerUseCase } from "./application/create-customer.use-case";
import { CustomerCacheUpserter } from "./application/customer-cache-upserter";
import { CustomerLookupAdapter } from "./application/customer-lookup.adapter";
import { GetCustomerUseCase } from "./application/get-customer.use-case";
import { ListCustomersUseCase } from "./application/list-customers.use-case";
import { ResolveCustomerUseCase } from "./application/resolve-customer.use-case";
import { CUSTOMER_REPOSITORY } from "./domain/ports/customer-repository.port";
import { PrismaCustomerRepository } from "./infrastructure/prisma-customer.repository";
import { CustomersController } from "./interfaces/customers.controller";
import { CustomersToolController } from "./interfaces/customers-tool.controller";

@Module({
  // CrmModule exports CRM_CUSTOMER_SYNC_PORT — the only thing this module
  // depends on from crm, matching the dependency direction in the module
  // roadmap (Customer Management depends on CRM Integration, never the
  // reverse).
  imports: [CrmModule],
  controllers: [CustomersController, CustomersToolController],
  providers: [
    { provide: CUSTOMER_REPOSITORY, useClass: PrismaCustomerRepository },
    // PrismaOutboxWriterFactory is already provided by CrmModule under this
    // same token, but CrmModule doesn't export it (only
    // CRM_CUSTOMER_SYNC_PORT is exported) — providing it again here is
    // cheap (no state) and keeps this module's dependency list honest
    // about what it actually uses, rather than reaching into crm's
    // internals for something crm itself doesn't advertise as shared.
    { provide: OUTBOX_WRITER_FACTORY, useClass: PrismaOutboxWriterFactory },
    CustomerCacheUpserter,
    ResolveCustomerUseCase,
    CreateCustomerUseCase,
    GetCustomerUseCase,
    ListCustomersUseCase,
    CustomerLookupAdapter,
    { provide: CUSTOMER_LOOKUP_PORT, useExisting: CustomerLookupAdapter },
  ],
  // GetCustomerUseCase: the notifications module needs it to resolve a
  // lead's customer name/phone/address for the notification payload.
  exports: [CUSTOMER_LOOKUP_PORT, GetCustomerUseCase],
})
export class CustomersModule {}
