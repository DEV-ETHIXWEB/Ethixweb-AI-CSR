import { randomUUID } from "node:crypto";
import type { UsageRecord } from "../../domain/usage-record.entity";
import type {
  CreateUsageRecordInput,
  Db,
  UsageRecordRepository,
  UsageSummaryFilter,
  UsageTypeTotal,
} from "../../domain/ports/usage-record-repository.port";
import { UsageRecordDedupKeyExistsError } from "../../infrastructure/prisma-usage-record.repository";

export class FakeUsageRecordRepository implements UsageRecordRepository {
  private readonly records = new Map<string, UsageRecord>();

  async create(_db: Db, input: CreateUsageRecordInput): Promise<UsageRecord> {
    for (const existing of this.records.values()) {
      if (existing.tenantId === input.tenantId && existing.dedupKey === input.dedupKey) {
        throw new UsageRecordDedupKeyExistsError(input.dedupKey);
      }
    }
    const record: UsageRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      businessId: input.businessId,
      callId: input.callId,
      leadId: input.leadId,
      usageType: input.usageType,
      source: input.source,
      quantity: input.quantity,
      unit: input.unit as UsageRecord["unit"],
      estimatedProviderCostUsd: input.estimatedProviderCostUsd,
      dedupKey: input.dedupKey,
      metadata: input.metadata,
      occurredAt: input.occurredAt,
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return record;
  }

  async findByDedupKey(_db: Db, tenantId: string, dedupKey: string): Promise<UsageRecord | null> {
    for (const record of this.records.values()) {
      if (record.tenantId === tenantId && record.dedupKey === dedupKey) {
        return record;
      }
    }
    return null;
  }

  async summarizeByType(_db: Db, filter: UsageSummaryFilter): Promise<UsageTypeTotal[]> {
    const from = new Date(filter.from).getTime();
    const to = new Date(filter.to).getTime();
    const matches = [...this.records.values()].filter((record) => {
      const occurredAt = new Date(record.occurredAt).getTime();
      return (
        record.tenantId === filter.tenantId &&
        (filter.businessId === undefined || record.businessId === filter.businessId) &&
        (filter.usageType === undefined || record.usageType === filter.usageType) &&
        (filter.callId === undefined || record.callId === filter.callId) &&
        occurredAt >= from &&
        occurredAt < to
      );
    });

    const groups = new Map<string, UsageTypeTotal>();
    for (const record of matches) {
      const key = `${record.usageType}:${record.unit}`;
      const existing = groups.get(key);
      const cost = record.estimatedProviderCostUsd ? Number(record.estimatedProviderCostUsd) : 0;
      if (existing) {
        existing.totalQuantity += record.quantity;
        existing.recordCount += 1;
        if (record.estimatedProviderCostUsd) {
          existing.totalEstimatedProviderCostUsd = (
            Number(existing.totalEstimatedProviderCostUsd ?? "0") + cost
          ).toFixed(6);
        }
      } else {
        groups.set(key, {
          usageType: record.usageType,
          unit: record.unit,
          totalQuantity: record.quantity,
          recordCount: 1,
          totalEstimatedProviderCostUsd: record.estimatedProviderCostUsd ? cost.toFixed(6) : null,
        });
      }
    }
    return [...groups.values()];
  }

  async listByCall(_db: Db, tenantId: string, callId: string): Promise<UsageRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.tenantId === tenantId && record.callId === callId)
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }

  /** Test helper. */
  seed(record: UsageRecord): void {
    this.records.set(record.id, record);
  }
}
