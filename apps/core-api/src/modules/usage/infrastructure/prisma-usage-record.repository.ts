import { Injectable } from "@nestjs/common";
import { Prisma } from "@ethixweb/database";
import type { UsageRecord, UsageType } from "../domain/usage-record.entity";
import type {
  CreateUsageRecordInput,
  Db,
  UsageRecordRepository,
  UsageSummaryFilter,
  UsageTypeTotal,
} from "../domain/ports/usage-record-repository.port";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/**
 * Not a {@link DomainError} subclass — mirrors NotificationDedupKeyExistsError's
 * own placement exactly: this is an infrastructure-layer signal for the
 * application layer to catch and translate (RecordUsageUseCase treats a
 * replayed dedupKey as a successful no-op, not an error the caller sees),
 * not itself an HTTP-mappable domain error.
 */
export class UsageRecordDedupKeyExistsError extends Error {
  constructor(public readonly dedupKey: string) {
    super(`A usage record with dedup key "${dedupKey}" already exists for this tenant.`);
    this.name = "UsageRecordDedupKeyExistsError";
  }
}

@Injectable()
export class PrismaUsageRecordRepository implements UsageRecordRepository {
  async create(db: Db, input: CreateUsageRecordInput): Promise<UsageRecord> {
    try {
      const row = await db.usageRecord.create({
        data: {
          tenantId: input.tenantId,
          businessId: input.businessId,
          callId: input.callId,
          leadId: input.leadId,
          usageType: input.usageType,
          source: input.source,
          quantity: input.quantity,
          unit: input.unit,
          estimatedProviderCostUsd: input.estimatedProviderCostUsd,
          dedupKey: input.dedupKey,
          metadata: input.metadata as Prisma.InputJsonValue,
          occurredAt: new Date(input.occurredAt),
        },
      });
      return toDomain(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new UsageRecordDedupKeyExistsError(input.dedupKey);
      }
      throw error;
    }
  }

  async findByDedupKey(db: Db, tenantId: string, dedupKey: string): Promise<UsageRecord | null> {
    const row = await db.usageRecord.findUnique({
      where: { tenantId_dedupKey: { tenantId, dedupKey } },
    });
    return row ? toDomain(row) : null;
  }

  async summarizeByType(db: Db, filter: UsageSummaryFilter): Promise<UsageTypeTotal[]> {
    const where: Prisma.UsageRecordWhereInput = {
      tenantId: filter.tenantId,
      occurredAt: { gte: new Date(filter.from), lt: new Date(filter.to) },
      ...(filter.businessId !== undefined ? { businessId: filter.businessId } : {}),
      ...(filter.usageType !== undefined ? { usageType: filter.usageType } : {}),
      ...(filter.callId !== undefined ? { callId: filter.callId } : {}),
    };

    const grouped = await db.usageRecord.groupBy({
      by: ["usageType", "unit"],
      where,
      _sum: { quantity: true, estimatedProviderCostUsd: true },
      _count: { _all: true },
    });

    return grouped.map((group) => ({
      usageType: group.usageType as UsageType,
      unit: group.unit,
      totalQuantity: group._sum?.quantity ?? 0,
      recordCount: group._count?._all ?? 0,
      totalEstimatedProviderCostUsd: group._sum?.estimatedProviderCostUsd?.toString() ?? null,
    }));
  }

  async listByCall(db: Db, tenantId: string, callId: string): Promise<UsageRecord[]> {
    const rows = await db.usageRecord.findMany({
      where: { tenantId, callId },
      orderBy: { occurredAt: "asc" },
    });
    return rows.map(toDomain);
  }
}

function toDomain(row: {
  id: string;
  tenantId: string;
  businessId: string;
  callId: string | null;
  leadId: string | null;
  usageType: string;
  source: string;
  quantity: number;
  unit: string;
  estimatedProviderCostUsd: { toString(): string } | null;
  dedupKey: string;
  metadata: unknown;
  occurredAt: Date;
  createdAt: Date;
}): UsageRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    callId: row.callId,
    leadId: row.leadId,
    usageType: row.usageType as UsageType,
    source: row.source,
    quantity: row.quantity,
    unit: row.unit as UsageRecord["unit"],
    estimatedProviderCostUsd: row.estimatedProviderCostUsd?.toString() ?? null,
    dedupKey: row.dedupKey,
    metadata: row.metadata as Record<string, unknown>,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
