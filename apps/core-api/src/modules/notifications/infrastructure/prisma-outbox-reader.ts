import { Injectable } from "@nestjs/common";
import type { OutboxRecord } from "@ethixweb/shared-kernel";
import { PrismaService } from "../../../shared/prisma/prisma.service";

/**
 * The READ half of the transactional outbox — `outbox_events` carries NO
 * row-level-security policy (confirmed against
 * packages/database/prisma/migrations/00000000000002_rls_policies:
 * granted directly to `app_runtime`, never added to the RLS-enabled
 * tenant-scoped-table loop), so this legitimately queries across every
 * tenant with the plain, non-tenant-scoped `PrismaService` — the one place
 * in this codebase that's correct, not an RLS bypass, since a relay
 * poller's whole job is "every tenant's pending events."
 */
@Injectable()
export class PrismaOutboxReader {
  constructor(private readonly prisma: PrismaService) {}

  async fetchPendingBatch(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.prisma.outboxEvent.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId ?? undefined,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      eventType: row.eventType,
      payload: row.payload,
      dedupKey: row.dedupKey ?? undefined,
      createdAt: row.createdAt,
    }));
  }

  async markDispatched(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: "dispatched", dispatchedAt: new Date() },
    });
  }
}
