import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { LeadNotFoundError } from "../domain/errors";
import { assertValidLeadStatusTransition } from "../domain/lead-lifecycle";
import type { Lead } from "../domain/lead.entity";
import type { LeadClaim } from "../domain/lead-claim.entity";
import {
  LEAD_CLAIM_REPOSITORY,
  type LeadClaimRepository,
} from "../domain/ports/lead-claim-repository.port";
import { LEAD_REPOSITORY, type LeadRepository } from "../domain/ports/lead-repository.port";

export interface ClaimLeadCommand {
  tenantId: string;
  leadId: string;
  claimedByUserId: string;
  claimMethod: string;
}

export interface ClaimLeadResult {
  lead: Lead;
  claim: LeadClaim;
}

/**
 * A dispatcher taking ownership of working a lead — docs/13
 * `leads` module §6's dispatcher-facing inbox. Race-safety here is the
 * OPPOSITE of createLead's: claiming is meant to be exclusive (only the
 * first of two dispatchers racing for the same hot lead should win), so
 * the `UNIQUE(lead_id)` constraint on `lead_claims` is enforced as a real
 * conflict (LeadAlreadyClaimedError) here, not silently converted into
 * "return the existing claim" the way the customers/leads CREATE races are.
 * Because only the winning caller ever reaches the status transition
 * below, that transition needs no separate concurrency control of its own
 * — it's already serialized by the claim race resolving first.
 */
@Injectable()
export class ClaimLeadUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(LEAD_REPOSITORY) private readonly leadRepository: LeadRepository,
    @Inject(LEAD_CLAIM_REPOSITORY) private readonly leadClaimRepository: LeadClaimRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: ClaimLeadCommand): Promise<ClaimLeadResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.lead_id": command.leadId,
    });

    return this.tenantContext.run(command.tenantId, async (db) => {
      const existing = await this.leadRepository.findById(db, command.tenantId, command.leadId);
      if (!existing) {
        throw new LeadNotFoundError(command.leadId);
      }
      // Rejects claiming an already-terminal lead (expired/duplicate/
      // converted_to_job/abandoned) with a clear IllegalLeadStatusTransitionError
      // — an already-"claimed" lead is instead caught by the LeadClaim
      // table's own uniqueness check just below, since that row would
      // already exist.
      assertValidLeadStatusTransition(existing.status, "claimed");

      const claim = await this.leadClaimRepository.create(db, {
        tenantId: command.tenantId,
        leadId: command.leadId,
        claimedByUserId: command.claimedByUserId,
        claimMethod: command.claimMethod,
      });

      const lead = await this.leadRepository.updateStatus(
        db,
        command.tenantId,
        command.leadId,
        existing.status,
        "claimed",
      );

      this.logger.info("lead claimed", {
        tenantId: command.tenantId,
        leadId: command.leadId,
        claimedByUserId: command.claimedByUserId,
      });

      return { lead, claim };
    });
  }
}
