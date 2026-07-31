import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { LeadNotFoundError, LeadUpdateNotAuthorizedError } from "../domain/errors";
import type { Lead } from "../domain/lead.entity";
import {
  LEAD_REPOSITORY,
  type LeadRepository,
  type UpdateLeadFieldsInput,
} from "../domain/ports/lead-repository.port";

export interface UpdateLeadCommand {
  tenantId: string;
  leadId: string;
  /** The call_id the caller claims to be updating from — docs/04 §3.4: "only callable within the same call_id that created the lead." */
  callId: string;
  patch: UpdateLeadFieldsInput;
}

/**
 * docs/04-ai-tool-architecture.md §3.4's `updateLead` tool — "amend a lead
 * created earlier in the same call." Deliberately LOCAL-ONLY: no adapter in
 * this codebase has a confirmed CRM-side "update lead" endpoint today
 * (HousecallProAdapter.updateLead() throws — see its own comment, a
 * genuine gap in Housecall Pro's public API, not an oversight here — see
 * docs/05-crm-integration.md §2.9), and docs/04 doesn't specify a
 * confirmed CRM-side round-trip contract for this tool either. Amending
 * the local record is the whole of this use-case's job; CRM-side
 * propagation is future work behind an unconfirmed contract, not
 * guessed at here.
 */
@Injectable()
export class UpdateLeadUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(LEAD_REPOSITORY) private readonly leadRepository: LeadRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: UpdateLeadCommand): Promise<Lead> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.lead_id": command.leadId,
    });

    return this.tenantContext.run(command.tenantId, async (db) => {
      const existing = await this.leadRepository.findById(db, command.tenantId, command.leadId);
      if (!existing) {
        throw new LeadNotFoundError(command.leadId);
      }
      if (existing.callId !== command.callId) {
        throw new LeadUpdateNotAuthorizedError(command.leadId, command.callId);
      }

      const updated = await this.leadRepository.updateFields(
        db,
        command.tenantId,
        command.leadId,
        command.patch,
      );
      this.logger.info("lead updated", { tenantId: command.tenantId, leadId: command.leadId });
      return updated;
    });
  }
}
