import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { UsageRecord } from "../domain/usage-record.entity";
import {
  USAGE_RECORD_REPOSITORY,
  type UsageRecordRepository,
} from "../domain/ports/usage-record-repository.port";

/**
 * The per-call breakdown docs/26 §12 names as the operational answer to
 * "why was this tenant charged/metered this amount" — every UsageRecord
 * correlated to one callId, in chronological order, straight from
 * persisted rows. No aggregation here deliberately: this is the raw
 * evidence trail a support engineer or reconciliation job reads, not a
 * summary (GetUsageSummaryUseCase is that).
 */
@Injectable()
export class GetCallUsageUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(USAGE_RECORD_REPOSITORY) private readonly usageRecordRepository: UsageRecordRepository,
  ) {}

  async execute(tenantId: string, callId: string): Promise<UsageRecord[]> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.call_id": callId });
    return this.tenantContext.run(tenantId, (db) =>
      this.usageRecordRepository.listByCall(db, tenantId, callId),
    );
  }
}
