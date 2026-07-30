import { randomUUID } from "node:crypto";
import { CustomerPhoneAlreadyExistsError } from "../../domain/errors";
import type { Customer } from "../../domain/customer.entity";
import type {
  CreateCustomerInput,
  CustomerRepository,
  Db,
  ListCustomersOptions,
  ListCustomersResult,
  UpdateCrmCacheInput,
} from "../../domain/ports/customer-repository.port";

export class FakeCustomerRepository implements CustomerRepository {
  private readonly customers = new Map<string, Customer>();

  // Synchronous body (no internal `await`) so this check-then-insert is
  // genuinely atomic with respect to other in-flight calls — the same
  // `(businessId, phoneE164)` uniqueness the real `@@unique` constraint
  // enforces in Postgres, and the same reasoning used for
  // FakeUserRepository/FakeIntegrationRepository elsewhere in this codebase.
  async create(_db: Db, input: CreateCustomerInput): Promise<Customer> {
    for (const existing of this.customers.values()) {
      if (existing.businessId === input.businessId && existing.phoneE164 === input.phoneE164) {
        throw new CustomerPhoneAlreadyExistsError(input.businessId, input.phoneE164);
      }
    }
    const now = new Date();
    const customer: Customer = {
      id: randomUUID(),
      tenantId: input.tenantId,
      businessId: input.businessId,
      crmCustomerId: input.crmCustomerId ?? null,
      phoneE164: input.phoneE164,
      name: input.name,
      email: input.email ?? null,
      address: input.address ?? null,
      crmRawCache: input.crmRawCache ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.customers.set(customer.id, customer);
    return customer;
  }

  async findById(_db: Db, tenantId: string, id: string): Promise<Customer | null> {
    const customer = this.customers.get(id);
    return customer && customer.tenantId === tenantId ? customer : null;
  }

  async findByPhone(
    _db: Db,
    tenantId: string,
    businessId: string,
    phoneE164: string,
  ): Promise<Customer | null> {
    for (const customer of this.customers.values()) {
      if (
        customer.tenantId === tenantId &&
        customer.businessId === businessId &&
        customer.phoneE164 === phoneE164
      ) {
        return customer;
      }
    }
    return null;
  }

  async updateCrmCache(
    _db: Db,
    tenantId: string,
    id: string,
    patch: UpdateCrmCacheInput,
  ): Promise<Customer> {
    const existing = this.customers.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`FakeCustomerRepository: no customer ${id} found for tenant ${tenantId}`);
    }
    const updated: Customer = {
      ...existing,
      ...(patch.crmCustomerId !== undefined ? { crmCustomerId: patch.crmCustomerId } : {}),
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.address !== undefined ? { address: patch.address } : {}),
      ...(patch.crmRawCache !== undefined ? { crmRawCache: patch.crmRawCache } : {}),
      updatedAt: new Date(),
    };
    this.customers.set(id, updated);
    return updated;
  }

  async listByBusiness(
    _db: Db,
    tenantId: string,
    businessId: string,
    options: ListCustomersOptions,
  ): Promise<ListCustomersResult> {
    let matches = [...this.customers.values()].filter(
      (customer) => customer.tenantId === tenantId && customer.businessId === businessId,
    );
    if (options.search) {
      const needle = options.search.toLowerCase();
      matches = matches.filter(
        (customer) =>
          customer.name.toLowerCase().includes(needle) ||
          customer.phoneE164.includes(options.search as string),
      );
    }
    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (options.page - 1) * options.pageSize;
    return { items: matches.slice(start, start + options.pageSize), total: matches.length };
  }

  /** Test helper — seed a customer directly, bypassing `create`. */
  seed(customer: Customer): void {
    this.customers.set(customer.id, customer);
  }
}
