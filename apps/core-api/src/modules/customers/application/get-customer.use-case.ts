import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Customer } from "../domain/customer.entity";
import { CustomerNotFoundError } from "../domain/errors";
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepository,
} from "../domain/ports/customer-repository.port";

@Injectable()
export class GetCustomerUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CUSTOMER_REPOSITORY) private readonly customerRepository: CustomerRepository,
  ) {}

  async execute(tenantId: string, customerId: string): Promise<Customer> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.customer_id": customerId });

    const customer = await this.tenantContext.run(tenantId, (db) =>
      this.customerRepository.findById(db, tenantId, customerId),
    );
    if (!customer) {
      throw new CustomerNotFoundError(customerId);
    }
    return customer;
  }
}
