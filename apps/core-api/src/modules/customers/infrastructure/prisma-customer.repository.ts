import { Injectable } from "@nestjs/common";
import { Prisma } from "@ethixweb/database";
import { CustomerPhoneAlreadyExistsError } from "../domain/errors";
import type { Customer } from "../domain/customer.entity";
import type {
  CreateCustomerInput,
  CustomerRepository,
  Db,
  ListCustomersOptions,
  ListCustomersResult,
  UpdateCrmCacheInput,
} from "../domain/ports/customer-repository.port";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

type CustomerRow = {
  id: string;
  tenantId: string;
  businessId: string;
  crmCustomerId: string | null;
  phoneE164: string;
  name: string;
  email: string | null;
  address: unknown;
  crmRawCache: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function toEntity(row: CustomerRow): Customer {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    crmCustomerId: row.crmCustomerId,
    phoneE164: row.phoneE164,
    name: row.name,
    email: row.email,
    address: (row.address ?? null) as Record<string, unknown> | null,
    crmRawCache: row.crmRawCache,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaCustomerRepository implements CustomerRepository {
  async create(db: Db, input: CreateCustomerInput): Promise<Customer> {
    try {
      const row = await db.customer.create({
        data: {
          tenantId: input.tenantId,
          businessId: input.businessId,
          phoneE164: input.phoneE164,
          name: input.name,
          email: input.email ?? null,
          address: input.address as Prisma.InputJsonValue,
          crmCustomerId: input.crmCustomerId ?? null,
          crmRawCache: input.crmRawCache as Prisma.InputJsonValue,
        },
      });
      return toEntity(row);
    } catch (error) {
      // Per docs/13-implementation-backlog.md `customers` module §4 — this
      // is the documented, expected outcome of a concurrent create for the
      // same phone number, not an unexpected failure. See
      // CustomerPhoneAlreadyExistsError's own comment for why this isn't a
      // DomainError: CustomerCacheUpserter always catches it internally.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new CustomerPhoneAlreadyExistsError(input.businessId, input.phoneE164);
      }
      throw error;
    }
  }

  async findById(db: Db, tenantId: string, id: string): Promise<Customer | null> {
    const row = await db.customer.findFirst({ where: { id, tenantId } });
    return row ? toEntity(row) : null;
  }

  async findByPhone(
    db: Db,
    tenantId: string,
    businessId: string,
    phoneE164: string,
  ): Promise<Customer | null> {
    const row = await db.customer.findFirst({ where: { tenantId, businessId, phoneE164 } });
    return row ? toEntity(row) : null;
  }

  async updateCrmCache(
    db: Db,
    tenantId: string,
    id: string,
    patch: UpdateCrmCacheInput,
  ): Promise<Customer> {
    // Built with conditional key inclusion, not `field: patch.field ?? null`
    // — this is a genuine PARTIAL update (a caller omitting a field means
    // "leave it alone," not "clear it"), and Prisma already treats an
    // OMITTED key that way. Coalescing to `null` instead would have
    // silently nulled out e.g. `crmCustomerId` on any future caller that
    // legitimately only wants to refresh `name`/`email`.
    const data: Prisma.CustomerUpdateManyMutationInput = {};
    if (patch.crmCustomerId !== undefined) {
      data.crmCustomerId = patch.crmCustomerId;
    }
    if (patch.name !== undefined) {
      data.name = patch.name;
    }
    if (patch.email !== undefined) {
      data.email = patch.email;
    }
    if (patch.address !== undefined) {
      data.address = patch.address as Prisma.InputJsonValue;
    }
    if (patch.crmRawCache !== undefined) {
      data.crmRawCache = patch.crmRawCache as Prisma.InputJsonValue;
    }

    // `update()` requires a unique-field WHERE (id alone) — updateMany + a
    // re-fetch keeps the explicit tenantId check, the same pattern used
    // throughout this codebase for a table with no compound unique
    // constraint on (id, tenantId) to lean on instead.
    const { count } = await db.customer.updateMany({ where: { id, tenantId }, data });
    if (count === 0) {
      throw new Error(
        `PrismaCustomerRepository.updateCrmCache: no customer ${id} found for tenant ${tenantId}`,
      );
    }
    const updated = await db.customer.findFirst({ where: { id, tenantId } });
    if (!updated) {
      throw new Error(
        `PrismaCustomerRepository.updateCrmCache: customer ${id} vanished after update`,
      );
    }
    return toEntity(updated);
  }

  async listByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListCustomersOptions,
  ): Promise<ListCustomersResult> {
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      businessId,
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: "insensitive" } },
              { phoneE164: { contains: options.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      db.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      db.customer.count({ where }),
    ]);

    return { items: rows.map(toEntity), total };
  }
}
