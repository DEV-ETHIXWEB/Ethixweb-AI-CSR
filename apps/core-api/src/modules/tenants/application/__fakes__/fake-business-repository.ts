import type { Business } from "../../domain/business.entity";
import type {
  BusinessRepository,
  CreateBusinessInput,
  Db,
  UpdateBusinessInput,
} from "../../domain/ports/business-repository.port";

export class FakeBusinessRepository implements BusinessRepository {
  private readonly businesses = new Map<string, Business>();
  private nextId = 1;

  async create(_db: Db, input: CreateBusinessInput): Promise<Business> {
    const now = new Date();
    const business: Business = {
      id: `business-${this.nextId++}`,
      tenantId: input.tenantId,
      name: input.name,
      timezone: input.timezone,
      crmType: input.crmType,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.businesses.set(business.id, business);
    return business;
  }

  async findById(_db: Db, tenantId: string, id: string): Promise<Business | null> {
    const business = this.businesses.get(id);
    return business && business.tenantId === tenantId ? business : null;
  }

  async listByTenant(_db: Db, tenantId: string): Promise<Business[]> {
    return [...this.businesses.values()].filter((business) => business.tenantId === tenantId);
  }

  async update(
    _db: Db,
    tenantId: string,
    id: string,
    input: UpdateBusinessInput,
  ): Promise<Business> {
    const existing = this.businesses.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`FakeBusinessRepository: no business ${id} found for tenant ${tenantId}`);
    }
    const updated: Business = {
      ...existing,
      name: input.name,
      timezone: input.timezone,
      updatedAt: new Date(),
    };
    this.businesses.set(id, updated);
    return updated;
  }

  /** Test helper — seed a business directly without going through `create`. */
  seed(business: Business): void {
    this.businesses.set(business.id, business);
  }
}
