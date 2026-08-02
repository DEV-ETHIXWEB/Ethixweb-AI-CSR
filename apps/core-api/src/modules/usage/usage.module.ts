import { Module } from "@nestjs/common";
import { GetCallUsageUseCase } from "./application/get-call-usage.use-case";
import { GetUsageSummaryUseCase } from "./application/get-usage-summary.use-case";
import { RecordUsageUseCase } from "./application/record-usage.use-case";
import { USAGE_RECORD_REPOSITORY } from "./domain/ports/usage-record-repository.port";
import { PrismaUsageRecordRepository } from "./infrastructure/prisma-usage-record.repository";
import { UsageController } from "./interfaces/usage.controller";
import { UsageToolController } from "./interfaces/usage-tool.controller";

/**
 * docs/26-usage-metering.md — usage/metering only, deliberately no
 * pricing/billing-ledger provider or module: per ADR-008/docs/15 §3.1,
 * Stripe is this platform's billing system of record, and this module's
 * job ends at "a normalized, deterministic usage measurement layer,"
 * exactly what docs/15 §3.2 requires to exist as ONE pipeline feeding both
 * the internal cost dashboard and a future Stripe usage-based billing
 * integration — not a parallel pricing/ledger engine.
 */
@Module({
  controllers: [UsageToolController, UsageController],
  providers: [
    { provide: USAGE_RECORD_REPOSITORY, useClass: PrismaUsageRecordRepository },
    RecordUsageUseCase,
    GetUsageSummaryUseCase,
    GetCallUsageUseCase,
  ],
  exports: [RecordUsageUseCase, GetUsageSummaryUseCase, GetCallUsageUseCase],
})
export class UsageModule {}
