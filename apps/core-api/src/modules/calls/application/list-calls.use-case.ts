import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { CallStatus } from "../domain/call.entity";
import {
  CALL_REPOSITORY,
  type CallRepository,
  type ListCallsResult,
} from "../domain/ports/call-repository.port";

export interface ListCallsQuery {
  tenantId: string;
  businessId: string;
  page: number;
  pageSize: number;
  status?: CallStatus | undefined;
  createdAfter?: Date | undefined;
  createdBefore?: Date | undefined;
}

/** Dispatcher-facing call inbox + the dashboard module's activeCallsCount/callsToday composition. Mirrors ListLeadsUseCase exactly. */
@Injectable()
export class ListCallsUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CALL_REPOSITORY) private readonly callRepository: CallRepository,
  ) {}

  async execute(query: ListCallsQuery): Promise<ListCallsResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": query.tenantId,
      "ethixweb.business_id": query.businessId,
    });

    return this.tenantContext.run(query.tenantId, (db) =>
      this.callRepository.listByBusiness(db, query.tenantId, query.businessId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        createdAfter: query.createdAfter,
        createdBefore: query.createdBefore,
      }),
    );
  }
}
