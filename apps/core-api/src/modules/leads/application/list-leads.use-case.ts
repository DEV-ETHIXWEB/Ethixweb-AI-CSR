import { Inject, Injectable } from "@nestjs/common";
import type { LeadStatus } from "@ethixweb/database";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import {
  LEAD_REPOSITORY,
  type LeadRepository,
  type ListLeadsResult,
} from "../domain/ports/lead-repository.port";

export interface ListLeadsQuery {
  tenantId: string;
  businessId: string;
  page: number;
  pageSize: number;
  status?: LeadStatus | undefined;
  priority?: string | undefined;
  createdAfter?: Date | undefined;
  createdBefore?: Date | undefined;
}

/** docs/13-implementation-backlog.md `leads` module §6: "Lead inbox API (list/filter by status/priority, for the dispatcher-facing dashboard)." */
@Injectable()
export class ListLeadsUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(LEAD_REPOSITORY) private readonly leadRepository: LeadRepository,
  ) {}

  async execute(query: ListLeadsQuery): Promise<ListLeadsResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": query.tenantId,
      "ethixweb.business_id": query.businessId,
    });

    return this.tenantContext.run(query.tenantId, (db) =>
      this.leadRepository.listByBusiness(db, query.tenantId, query.businessId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        priority: query.priority,
        createdAfter: query.createdAfter,
        createdBefore: query.createdBefore,
      }),
    );
  }
}
