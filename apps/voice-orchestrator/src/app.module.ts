import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { AiProviderModule } from "./modules/ai-provider/ai-provider.module";
import { ConversationModule } from "./modules/conversation/conversation.module";
import { EventsModule } from "./modules/events/events.module";
import { HealthModule } from "./modules/health/health.module";
import { PromptModule } from "./modules/prompt/prompt.module";
import { ToolBrokerModule } from "./modules/tool-broker/tool-broker.module";
import { AppLoggerModule } from "./shared/observability/app-logger.module";
import { RedisModule } from "./shared/redis/redis.module";
import { ServiceAuthGuard } from "./shared/auth/service-auth.guard";
import { validate } from "./shared/config/env.schema";
import { DomainExceptionFilter } from "./shared/http/domain-exception.filter";

@Module({
  imports: [
    // `validate` (shared/config/env.schema.ts) fails bootstrap immediately
    // on a missing/malformed required var (REDIS_URL, CORE_API_BASE_URL,
    // CORE_API_SERVICE_API_KEY, ORCHESTRATOR_SERVICE_TOKEN) rather than
    // this service silently rejecting every call once it's already live.
    ConfigModule.forRoot({ isGlobal: true, validate }),
    AppLoggerModule,
    RedisModule,
    HealthModule,
    EventsModule,
    AiProviderModule,
    PromptModule,
    ToolBrokerModule,
    ConversationModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ServiceAuthGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
