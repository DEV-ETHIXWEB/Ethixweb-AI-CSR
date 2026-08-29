import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { InvalidUsageQuantityError, UsageOccurredInFutureError } from "../domain/errors";
import type { UsageRecord, UsageType } from "../domain/usage-record.entity";
import {
  USAGE_RECORD_REPOSITORY,
  type UsageRecordRepository,
} from "../domain/ports/usage-record-repository.port";
import { UsageRecordDedupKeyExistsError } from "../infrastructure/prisma-usage-record.repository";

export interface RecordUsageCommand {
  tenantId: string;
  businessId: string;
  callId?: string | undefined;
  leadId?: string | undefined;
  usageType: UsageType;
  source: string;
  quantity: number;
  unit: string;
  estimatedProviderCostUsd?: string | undefined;
  /** Client-generated, unique per real usage event — see this use case's own comment for the exact dedup contract. */
  dedupKey: string;
  metadata?: Record<string, unknown> | undefined;
  occurredAt: string;
}

/** A small clock-skew allowance — real distributed callers (voice-orchestrator, a Twilio webhook handler) are never perfectly synchronized, and rejecting every usage event that's a few seconds "in the future" due to ordinary clock drift would be a worse failure mode than the drift itself. */
const FUTURE_TOLERANCE_MS = 60_000;

/**
 * docs/26-usage-metering.md's ingestion contract: platform modules record a
 * normalized usage event without knowing anything about billing/pricing —
 * this use case is the ONLY way a `UsageRecord` row gets created.
 *
 * Idempotent by design, the same discipline as SendLeadNotificationUseCase's
 * `dedupKey`/CreateLeadUseCase's `UNIQUE(call_id)`: a replayed usage event
 * (the caller retries after a lost response, an at-least-once event bus
 * redelivers) with the SAME `dedupKey` returns the existing row rather than
 * creating a second one — "repeated delivery of the same usage event must
 * not double bill" is enforced at the database's own unique-constraint
 * layer, not just an application-level check, per this codebase's
 * established pattern for every other financially/operationally sensitive
 * write.
 */
@Injectable()
export class RecordUsageUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(USAGE_RECORD_REPOSITORY) private readonly usageRecordRepository: UsageRecordRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: RecordUsageCommand): Promise<UsageRecord> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
      "ethixweb.usage_type": command.usageType,
    });

    if (!Number.isInteger(command.quantity) || command.quantity < 0) {
      throw new InvalidUsageQuantityError(command.quantity);
    }
    const occurredAtMs = Date.parse(command.occurredAt);
    if (occurredAtMs > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new UsageOccurredInFutureError(command.occurredAt);
    }

    return this.tenantContext.run(command.tenantId, async (db) => {
      // A SAVEPOINT immediately before the insert attempt — Postgres aborts
      // the ENTIRE enclosing transaction after any error (including this
      // dedupKey unique-constraint violation), so without this, the
      // recovery findByDedupKey read below fails with `25P02: current
      // transaction is aborted`. Identical bug, identical fix, as
      // CreateLeadUseCase.upsertByCallId / CustomerCacheUpserter.upsert /
      // StartCallUseCase — see any of their comments for the full
      // explanation; found here by deliberately searching the codebase for
      // every "catch a P2002-mapped error, then read on the same db" call
      // site after the first instance was found live.
      await db.$executeRaw`SAVEPOINT record_usage_attempt`;
      try {
        const record = await this.usageRecordRepository.create(db, {
          tenantId: command.tenantId,
          businessId: command.businessId,
          callId: command.callId ?? null,
          leadId: command.leadId ?? null,
          usageType: command.usageType,
          source: command.source,
          quantity: command.quantity,
          unit: command.unit,
          estimatedProviderCostUsd: command.estimatedProviderCostUsd ?? null,
          dedupKey: command.dedupKey,
          metadata: command.metadata ?? {},
          occurredAt: command.occurredAt,
        });
        this.logger.info("usage recorded", {
          tenantId: record.tenantId,
          usageType: record.usageType,
          source: record.source,
          quantity: record.quantity,
        });
        return record;
      } catch (error) {
        if (!(error instanceof UsageRecordDedupKeyExistsError)) {
          throw error;
        }
        // Un-poisons the transaction so the recovery read below can
        // actually run — see the SAVEPOINT comment above.
        await db.$executeRaw`ROLLBACK TO SAVEPOINT record_usage_attempt`;
        const existing = await this.usageRecordRepository.findByDedupKey(
          db,
          command.tenantId,
          command.dedupKey,
        );
        if (!existing) {
          throw new Error(
            `RecordUsageUseCase: dedup-key constraint violation for "${command.dedupKey}" but no row found on re-fetch`,
          );
        }
        this.logger.info("usage ingestion replayed — returned the existing record", {
          tenantId: existing.tenantId,
          usageRecordId: existing.id,
          dedupKey: existing.dedupKey,
        });
        return existing;
      }
    });
  }
}
