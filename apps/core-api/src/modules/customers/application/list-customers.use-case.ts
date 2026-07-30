import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepository,
  type ListCustomersResult,
} from "../domain/ports/customer-repository.port";

export interface ListCustomersQuery {
  tenantId: string;
  businessId: string;
  page: number;
  pageSize: number;
  search?: string | undefined;
}

@Injectable()
export class ListCustomersUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CUSTOMER_REPOSITORY) private readonly customerRepository: CustomerRepository,
  ) {}

  async execute(query: ListCustomersQuery): Promise<ListCustomersResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": query.tenantId,
      "ethixweb.business_id": query.businessId,
    });

    return this.tenantContext.run(query.tenantId, (db) =>
      this.customerRepository.listByBusiness(db, query.tenantId, query.businessId, {
        page: query.page,
        pageSize: query.pageSize,
        search: query.search,
      }),
    );
  }
}
