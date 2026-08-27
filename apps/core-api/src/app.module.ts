import { Module } from "@nestjs/common";
import { resolve } from "node:path";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./modules/auth/auth.module";
import { CallsModule } from "./modules/calls/calls.module";
import { CapacityConfigModule } from "./modules/capacity-config/capacity-config.module";
import { CrmModule } from "./modules/crm/crm.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { EmergencyRulesModule } from "./modules/emergency-rules/emergency-rules.module";
import { HealthModule } from "./modules/health/health.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { UsageModule } from "./modules/usage/usage.module";
import { validate } from "./shared/config/env.schema";
import { DomainExceptionFilter } from "./shared/http/domain-exception.filter";
import { AppLoggerModule } from "./shared/observability/app-logger.module";
import { PrismaModule } from "./shared/prisma/prisma.module";
import { RedisModule } from "./shared/redis/redis.module";

@Module({
  imports: [
    // `validate` (shared/config/env.schema.ts) fails bootstrap immediately
    // on a missing/malformed required var — see that file's own comment on
    // why this exists instead of every secret failing lazily, mid-request,
    // the first time its owning service is instantiated.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, "../../../.env"),
      validate,
    }),
    AppLoggerModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    // AuthModule registers AuthGuard/RolesGuard as APP_GUARD (see its own
    // comment) — every route in every module below is authenticated by
    // default from this point on, unless marked `@Public()`.
    AuthModule,
    TenantsModule,
    CrmModule,
    CustomersModule,
    CallsModule,
    LeadsModule,
    EmergencyRulesModule,
    NotificationsModule,
    UsageModule,
    KnowledgeModule,
    CapacityConfigModule,
    DashboardModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
