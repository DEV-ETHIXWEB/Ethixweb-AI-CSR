import type { CustomerLookupPort, LookedUpCustomer } from "../../domain/ports/customer-lookup.port";

export class FakeCustomerLookupPort implements CustomerLookupPort {
  private readonly customers = new Map<string, LookedUpCustomer>();

  async findById(tenantId: string, customerId: string): Promise<LookedUpCustomer | null> {
    const customer = this.customers.get(customerId);
    return customer && customer.tenantId === tenantId ? customer : null;
  }

  /** Test helper — seed a customer directly. */
  seed(customer: LookedUpCustomer): void {
    this.customers.set(customer.id, customer);
  }
}
