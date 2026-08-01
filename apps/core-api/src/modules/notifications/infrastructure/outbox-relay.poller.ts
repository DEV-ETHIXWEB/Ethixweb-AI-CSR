import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { relayOutboxBatch, type OutboxRecord } from "@ethixweb/shared-kernel";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { SendLeadNotificationUseCase } from "../application/send-lead-notification.use-case";
import { PrismaOutboxReader } from "./prisma-outbox-reader";

const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 20;

/**
 * TECHNICAL DEBT, flagged deliberately: docs/01 §9's deployment diagram
 * models the outbox consumer as a SEPARATE "Service: workers" (BullMQ
 * processors), matching the same "voice-orchestrator is its own service"
 * pattern this build already applied once. Standing up a second whole app
 * for what is, for a Phase 1 single-tenant pilot, a lightweight poller is
 * disproportionate scaffolding cost right now — the same "over-engineering
 * for a Phase 1 single-tenant pilot" reasoning docs/01 §9 itself uses to
 * justify Fargate-over-EKS. This in-process interval poller calls the
 * EXACT SAME `relayOutboxBatch` pure function (@ethixweb/shared-kernel)
 * the documented BullMQ worker would call — migrating to a real separate
 * service later is swapping this poller's `setInterval` trigger for a
 * BullMQ cron processor, not rewriting the relay logic itself.
 */
@Injectable()
export class OutboxRelayPoller implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly outboxReader: PrismaOutboxReader,
    private readonly sendLeadNotification: SendLeadNotificationUseCase,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  onModuleInit(): void {
    if (process.env["NODE_ENV"] === "test" || process.env["OUTBOX_RELAY_DISABLED"] === "true") {
      return;
    }
    this.timer = setInterval(() => {
      this.runOnce().catch((error: unknown) => {
        this.logger.error("outbox relay pass failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    await relayOutboxBatch(
      {
        fetchPendingBatch: (limit) => this.outboxReader.fetchPendingBatch(limit),
        markDispatched: (id) => this.outboxReader.markDispatched(id),
        publish: (record) => this.publish(record),
        onError: (record, error) => {
          this.logger.warn("outbox event dispatch failed — will retry next pass", {
            eventId: record.id,
            eventType: record.eventType,
            reason: error instanceof Error ? error.message : String(error),
          });
        },
      },
      BATCH_SIZE,
    );
  }

  private async publish(record: OutboxRecord): Promise<void> {
    if (record.eventType !== "lead.created" || !record.tenantId) {
      return;
    }
    const payload = record.payload as { leadId?: string; businessId?: string };
    if (!payload.leadId || !payload.businessId) {
      return;
    }
    await this.sendLeadNotification.execute({
      tenantId: record.tenantId,
      businessId: payload.businessId,
      leadId: payload.leadId,
    });
  }
}
