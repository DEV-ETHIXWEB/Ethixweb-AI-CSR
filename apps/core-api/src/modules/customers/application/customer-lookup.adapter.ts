import { Inject, Injectable } from "@nestjs/common";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type {
  CustomerLookupPort,
  LookedUpCustomer,
} from "../../leads/domain/ports/customer-lookup.port";
import {
  CUSTOMER_REPOSITORY,
  type CustomerRepository,
} from "../domain/ports/customer-repository.port";

/**
 * Implements the leads module's own CustomerLookupPort by delegating to
 * this module's already-built, tenant-scoped CustomerRepository — the
 * leads module never touches customers' Prisma model or repository
 * directly, only this narrow lookup.
 */
@Injectable()
export class CustomerLookupAdapter implements CustomerLookupPort {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CUSTOMER_REPOSITORY) private readonly customerRepository: CustomerRepository,
  ) {}

  async findById(tenantId: string, customerId: string): Promise<LookedUpCustomer | null> {
    const customer = await this.tenantContext.run(tenantId, (db) =>
      this.customerRepository.findById(db, tenantId, customerId),
    );
    if (!customer) {
      return null;
    }
    return {
      id: customer.id,
      tenantId: customer.tenantId,
      businessId: customer.businessId,
      crmCustomerId: customer.crmCustomerId,
    };
  }
}
