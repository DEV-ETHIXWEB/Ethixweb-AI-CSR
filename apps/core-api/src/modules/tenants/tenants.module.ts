import { Module } from "@nestjs/common";
import { CreateBusinessUseCase } from "./application/create-business.use-case";
import { CreateTenantUseCase } from "./application/create-tenant.use-case";
import { GetBusinessUseCase } from "./application/get-business.use-case";
import { GetTenantUseCase } from "./application/get-tenant.use-case";
import { ListBusinessesUseCase } from "./application/list-businesses.use-case";
import { TransitionTenantStatusUseCase } from "./application/transition-tenant-status.use-case";
import { UpdateBusinessUseCase } from "./application/update-business.use-case";
import { UpdateTenantUseCase } from "./application/update-tenant.use-case";
import { BUSINESS_REPOSITORY } from "./domain/ports/business-repository.port";
import { TENANT_REPOSITORY } from "./domain/ports/tenant-repository.port";
import { PrismaBusinessRepository } from "./infrastructure/prisma-business.repository";
import { PrismaTenantRepository } from "./infrastructure/prisma-tenant.repository";
import { BusinessesController } from "./interfaces/businesses.controller";
import { TenantStatusToolController } from "./interfaces/tenant-status-tool.controller";
import { TenantsController } from "./interfaces/tenants.controller";

@Module({
  controllers: [TenantsController, BusinessesController, TenantStatusToolController],
  providers: [
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
    { provide: BUSINESS_REPOSITORY, useClass: PrismaBusinessRepository },
    CreateTenantUseCase,
    GetTenantUseCase,
    TransitionTenantStatusUseCase,
    UpdateTenantUseCase,
    CreateBusinessUseCase,
    GetBusinessUseCase,
    ListBusinessesUseCase,
    UpdateBusinessUseCase,
  ],
  // GetBusinessUseCase: emergency-rules module's GetBusinessHoursUseCase
  // needs a business's own `timezone` column to correctly evaluate
  // business-hours (see that class's own comment) — the same
  // cross-module use-case reuse pattern already established elsewhere
  // (e.g. SendLeadNotificationUseCase importing GetLeadUseCase/
  // GetCustomerUseCase from other modules), not a new precedent.
  exports: [GetBusinessUseCase],
})
export class TenantsModule {}
