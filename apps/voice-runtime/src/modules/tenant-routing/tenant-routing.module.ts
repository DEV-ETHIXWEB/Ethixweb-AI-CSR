import { Module } from "@nestjs/common";
import { TENANT_ROUTING_PROVIDER } from "./domain/tenant-routing.port";
import { StaticTenantRoutingProvider } from "./infrastructure/static-tenant-routing.provider";

@Module({
  providers: [{ provide: TENANT_ROUTING_PROVIDER, useClass: StaticTenantRoutingProvider }],
  exports: [TENANT_ROUTING_PROVIDER],
})
export class TenantRoutingModule {}
