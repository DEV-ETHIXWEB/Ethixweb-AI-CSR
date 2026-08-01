import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./modules/auth/auth.module";
import { CrmModule } from "./modules/crm/crm.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { EmergencyRulesModule } from "./modules/emergency-rules/emergency-rules.module";
import { HealthModule } from "./modules/health/health.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { DomainExceptionFilter } from "./shared/http/domain-exception.filter";
import { AppLoggerModule } from "./shared/observability/app-logger.module";
import { PrismaModule } from "./shared/prisma/prisma.module";
import { RedisModule } from "./shared/redis/redis.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
    LeadsModule,
    EmergencyRulesModule,
    NotificationsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
