import { Module } from "@nestjs/common";
import { RedisIdempotencyStore } from "@ethixweb/shared-kernel";
import { RedisService } from "../../shared/redis/redis.service";
import { IDEMPOTENCY_STORE } from "../../shared/idempotency/idempotency-store.token";
import { CORE_API_CLIENT } from "./domain/ports/core-api-client.port";
import { TOOL_AUDIT_LOG } from "./domain/ports/tool-audit-log.port";
import { ExecuteToolUseCase } from "./application/execute-tool.use-case";
import { CreateCustomerHandler } from "./application/handlers/create-customer.handler";
import { CreateLeadHandler } from "./application/handlers/create-lead.handler";
import { EscalateEmergencyHandler } from "./application/handlers/escalate-emergency.handler";
import { GetBusinessHoursHandler } from "./application/handlers/get-business-hours.handler";
import { GetServiceAreasHandler } from "./application/handlers/get-service-areas.handler";
import { LookupPreviousCallsHandler } from "./application/handlers/lookup-previous-calls.handler";
import { SearchCustomerHandler } from "./application/handlers/search-customer.handler";
import { UpdateLeadHandler } from "./application/handlers/update-lead.handler";
import { ToolRegistrar } from "./application/tool-registrar";
import { ToolRegistry } from "./application/tool-registry";
import { HttpCoreApiClient } from "./infrastructure/http-core-api-client";
import { RedisToolAuditLogAdapter } from "./infrastructure/redis-tool-audit-log.adapter";

@Module({
  providers: [
    {
      provide: IDEMPOTENCY_STORE,
      useFactory: (redis: RedisService) => new RedisIdempotencyStore(redis, "tool-idempotency:"),
      inject: [RedisService],
    },
    { provide: TOOL_AUDIT_LOG, useClass: RedisToolAuditLogAdapter },
    { provide: CORE_API_CLIENT, useClass: HttpCoreApiClient },
    ToolRegistry,
    ExecuteToolUseCase,
    ToolRegistrar,
    SearchCustomerHandler,
    CreateCustomerHandler,
    CreateLeadHandler,
    UpdateLeadHandler,
    GetBusinessHoursHandler,
    GetServiceAreasHandler,
    EscalateEmergencyHandler,
    LookupPreviousCallsHandler,
  ],
  // CORE_API_CLIENT exported for the identical reason IDEMPOTENCY_STORE
  // already is (see that export's own history) — the production-blocker
  // fix now needs ConversationModule's StartConversationUseCase/
  // EndConversationUseCase to reach core-api's new calls module directly,
  // reusing this exact HttpCoreApiClient/CoreApiClientPort rather than
  // duplicating a second HTTP client.
  exports: [ExecuteToolUseCase, ToolRegistry, IDEMPOTENCY_STORE, CORE_API_CLIENT],
})
export class ToolBrokerModule {}
