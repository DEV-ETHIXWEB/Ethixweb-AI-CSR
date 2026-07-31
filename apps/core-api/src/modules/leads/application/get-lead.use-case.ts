import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { LeadNotFoundError } from "../domain/errors";
import type { Lead } from "../domain/lead.entity";
import { LEAD_REPOSITORY, type LeadRepository } from "../domain/ports/lead-repository.port";

@Injectable()
export class GetLeadUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(LEAD_REPOSITORY) private readonly leadRepository: LeadRepository,
  ) {}

  async execute(tenantId: string, leadId: string): Promise<Lead> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.lead_id": leadId });

    const lead = await this.tenantContext.run(tenantId, (db) =>
      this.leadRepository.findById(db, tenantId, leadId),
    );
    if (!lead) {
      throw new LeadNotFoundError(leadId);
    }
    return lead;
  }
}
