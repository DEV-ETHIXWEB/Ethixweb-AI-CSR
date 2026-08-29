import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ToolBrokerModule } from "../tool-broker/tool-broker.module";
import { CALL_ADMISSION_PORT } from "./domain/call-admission.port";
import { CAPACITY_CONFIG_PROVIDER } from "./domain/capacity-config";
import { TENANT_STATUS_PROVIDER } from "./domain/tenant-status.port";
import { HttpCapacityConfigProvider } from "./infrastructure/http-capacity-config.provider";
import { HttpTenantStatusProvider } from "./infrastructure/http-tenant-status.provider";
import { RedisCallAdmissionAdapter } from "./infrastructure/redis-call-admission.adapter";
import { CapacityExceededFilter } from "./interfaces/capacity-exceeded.filter";

/**
 * Imports ToolBrokerModule for its exported `CORE_API_CLIENT` binding,
 * which HttpCapacityConfigProvider needs — checked for a cycle first:
 * ToolBrokerModule imports nothing from this module (its own module file
 * has no CapacityModule import, directly or transitively), and
 * app.module.ts already registers ToolBrokerModule before CapacityModule,
 * so this import direction is safe. A dedicated shared
 * `core-api-client.module.ts` was considered (extracting just the
 * CORE_API_CLIENT binding out of ToolBrokerModule) but rejected as
 * unnecessary churn — ToolBrokerModule already exports the token
 * specifically for a second consumer (see ITS own export comment, added
 * for ConversationModule's StartConversationUseCase/EndConversationUseCase
 * needing the exact same client), so this is the third and following the
 * same established pattern, not a new one.
 */
@Module({
  imports: [ToolBrokerModule],
  providers: [
    { provide: CALL_ADMISSION_PORT, useClass: RedisCallAdmissionAdapter },
    { provide: CAPACITY_CONFIG_PROVIDER, useClass: HttpCapacityConfigProvider },
    { provide: TENANT_STATUS_PROVIDER, useClass: HttpTenantStatusProvider },
    // Registered here rather than app.module.ts (unlike the app-wide
    // DomainExceptionFilter) so this filter's dependency on
    // CAPACITY_CONFIG_PROVIDER stays scoped to the module that owns it.
    // Nest matches @Catch(CapacityExceededError) ahead of the broader
    // @Catch(DomainError) filter for that specific error type — both can
    // coexist as APP_FILTER providers.
    { provide: APP_FILTER, useClass: CapacityExceededFilter },
  ],
  exports: [CALL_ADMISSION_PORT, CAPACITY_CONFIG_PROVIDER, TENANT_STATUS_PROVIDER],
})
export class CapacityModule {}
