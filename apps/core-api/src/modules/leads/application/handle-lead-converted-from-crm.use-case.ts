import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { assertValidLeadStatusTransition } from "../domain/lead-lifecycle";
import type { Lead } from "../domain/lead.entity";
import { LEAD_REPOSITORY, type LeadRepository } from "../domain/ports/lead-repository.port";

export interface HandleLeadConvertedFromCrmCommand {
  tenantId: string;
  crmLeadId: string;
}

/**
 * docs/13-implementation-backlog.md `leads` module §5: "`converted_to_job`
 * webhook handler (from the CRM adapter's webhook receiver, closes the
 * loop once a human actually schedules)." The WRITE half of this loop
 * already exists — the crm module's ReceiveCrmWebhookUseCase (Phase 3)
 * verifies the webhook signature, deduplicates by provider event id, and
 * publishes a normalized `crm.{crmType}.lead.converted` event to the
 * outbox. This use-case is the logical HANDLER for that event (resolve the
 * local lead by `crmLeadId`, transition it to `converted_to_job`) — fully
 * implemented and tested, but NOT wired to run automatically: no
 * outbox-polling worker/job-queue exists anywhere in this codebase yet
 * (shared-kernel's `relayOutboxBatch` is a pure function nothing currently
 * calls on a schedule). Wiring this to fire automatically is genuinely
 * infrastructure work belonging to whichever module first needs a live
 * outbox consumer, not invented here just for this one handler.
 *
 * Idempotent by design: if the lead is already `converted_to_job` (e.g. a
 * redelivered webhook), this is a no-op success, not an error —
 * `assertValidLeadStatusTransition` treats a same-status "transition" that
 * way for exactly this reason.
 */
@Injectable()
export class HandleLeadConvertedFromCrmUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(LEAD_REPOSITORY) private readonly leadRepository: LeadRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  /** Returns null (not an error) if no local lead matches this crmLeadId — a lead-management-agnostic CRM record, or one not yet synced, is not this handler's problem to raise. */
  async execute(command: HandleLeadConvertedFromCrmCommand): Promise<Lead | null> {
    setSpanAttributes({ "ethixweb.tenant_id": command.tenantId });

    return this.tenantContext.run(command.tenantId, async (db) => {
      const lead = await this.leadRepository.findByCrmLeadId(
        db,
        command.tenantId,
        command.crmLeadId,
      );
      if (!lead) {
        this.logger.warn("received a lead.converted CRM event with no matching local lead", {
          tenantId: command.tenantId,
          crmLeadId: command.crmLeadId,
        });
        return null;
      }

      assertValidLeadStatusTransition(lead.status, "converted_to_job");
      const updated = await this.leadRepository.updateStatus(
        db,
        command.tenantId,
        lead.id,
        lead.status,
        "converted_to_job",
      );

      this.logger.info("lead converted to job (from CRM webhook)", {
        tenantId: command.tenantId,
        leadId: lead.id,
        crmLeadId: command.crmLeadId,
      });

      return updated;
    });
  }
}
