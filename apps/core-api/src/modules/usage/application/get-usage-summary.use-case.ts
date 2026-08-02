import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { UsageType } from "../domain/usage-record.entity";
import {
  USAGE_RECORD_REPOSITORY,
  type UsageRecordRepository,
  type UsageTypeTotal,
} from "../domain/ports/usage-record-repository.port";
import { InvalidUsagePeriodError } from "../domain/errors";

export interface GetUsageSummaryQuery {
  tenantId: string;
  businessId?: string | undefined;
  usageType?: UsageType | undefined;
  /** Inclusive lower bound. */
  from: string;
  /** Exclusive upper bound — a half-open interval, so a caller can tile consecutive periods (e.g. midnight-to-midnight days) without a record landing in two summaries or none. */
  to: string;
}

export interface UsageSummary {
  tenantId: string;
  businessId: string | null;
  from: string;
  to: string;
  totals: UsageTypeTotal[];
}

/**
 * docs/26 §3's metering contract: deterministic aggregation, reproducible
 * from the underlying `UsageRecord` rows at any time — this use case never
 * reads a cached/materialized total, it always recomputes from raw rows,
 * so "why was this tenant's usage X" is always answerable by re-running the
 * exact same query, not by trusting a number that could have drifted from
 * its source data.
 */
@Injectable()
export class GetUsageSummaryUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(USAGE_RECORD_REPOSITORY) private readonly usageRecordRepository: UsageRecordRepository,
  ) {}

  async execute(query: GetUsageSummaryQuery): Promise<UsageSummary> {
    setSpanAttributes({ "ethixweb.tenant_id": query.tenantId });

    if (Date.parse(query.from) >= Date.parse(query.to)) {
      throw new InvalidUsagePeriodError(query.from, query.to);
    }

    const totals = await this.tenantContext.run(query.tenantId, (db) =>
      this.usageRecordRepository.summarizeByType(db, {
        tenantId: query.tenantId,
        businessId: query.businessId,
        usageType: query.usageType,
        from: query.from,
        to: query.to,
      }),
    );

    return {
      tenantId: query.tenantId,
      businessId: query.businessId ?? null,
      from: query.from,
      to: query.to,
      totals,
    };
  }
}
