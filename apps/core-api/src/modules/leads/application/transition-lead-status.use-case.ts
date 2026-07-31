import { Inject, Injectable } from "@nestjs/common";
import type { LeadStatus } from "@ethixweb/database";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { LeadNotFoundError } from "../domain/errors";
import { assertValidLeadStatusTransition } from "../domain/lead-lifecycle";
import type { Lead } from "../domain/lead.entity";
import { LEAD_REPOSITORY, type LeadRepository } from "../domain/ports/lead-repository.port";

/** docs/13-implementation-backlog.md `leads` module §4's state machine — dispatcher-driven terminal transitions (mark expired/duplicate/abandoned/converted_to_job). */
@Injectable()
export class TransitionLeadStatusUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(LEAD_REPOSITORY) private readonly leadRepository: LeadRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(tenantId: string, leadId: string, toStatus: LeadStatus): Promise<Lead> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.lead_id": leadId });

    return this.tenantContext.run(tenantId, async (db) => {
      const existing = await this.leadRepository.findById(db, tenantId, leadId);
      if (!existing) {
        throw new LeadNotFoundError(leadId);
      }
      assertValidLeadStatusTransition(existing.status, toStatus);

      // `existing.status` (not `toStatus`) as fromStatus — closes the same
      // write-write race TransitionTenantStatusUseCase's own comment
      // explains: a concurrent transition off the same starting status must
      // be detected, not silently overwritten.
      const updated = await this.leadRepository.updateStatus(
        db,
        tenantId,
        leadId,
        existing.status,
        toStatus,
      );

      this.logger.info("lead status transitioned", {
        tenantId,
        leadId,
        fromStatus: existing.status,
        toStatus,
      });

      return updated;
    });
  }
}
