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
import { DomainExceptionFilter } from "./shared/http/domain-exception.filter";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
