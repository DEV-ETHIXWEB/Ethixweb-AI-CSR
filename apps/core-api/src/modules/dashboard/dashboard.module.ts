import { Module } from "@nestjs/common";
import { CallsModule } from "../calls/calls.module";
import { CapacityConfigModule } from "../capacity-config/capacity-config.module";
import { CrmModule } from "../crm/crm.module";
import { LeadsModule } from "../leads/leads.module";
import { UsageModule } from "../usage/usage.module";
import { GetDashboardHealthUseCase } from "./application/get-dashboard-health.use-case";
import { GetDashboardOverviewUseCase } from "./application/get-dashboard-overview.use-case";
import { ListDashboardEmergenciesUseCase } from "./application/list-dashboard-emergencies.use-case";
import { DashboardController } from "./interfaces/dashboard.controller";

/**
 * A pure composition module — no domain/ports/infrastructure folders of
 * its own (see this module's application use cases' own comments): every
 * use case here injects OTHER modules' already-exported use cases
 * (ListCallsUseCase, ListLeadsUseCase, GetUsageSummaryUseCase,
 * GetCapacityConfigUseCase, ListIntegrationsUseCase) rather than touching
 * Prisma directly, with the sole exception of GetDashboardHealthUseCase's
 * narrow `SELECT 1` probe via the globally-provided PrismaService (no
 * import of PrismaModule needed here — it's `@Global()`).
 */
@Module({
  imports: [CallsModule, LeadsModule, UsageModule, CapacityConfigModule, CrmModule],
  controllers: [DashboardController],
  providers: [
    GetDashboardOverviewUseCase,
    ListDashboardEmergenciesUseCase,
    GetDashboardHealthUseCase,
  ],
})
export class DashboardModule {}
