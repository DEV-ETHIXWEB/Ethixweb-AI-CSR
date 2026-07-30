import { Injectable } from "@nestjs/common";
import type { Prisma } from "@ethixweb/database";
import { PrismaService } from "./prisma.service";

export type TenantScopedDb = Prisma.TransactionClient;

/**
 * The actual mechanism behind docs/06-database-schema.md §1's RLS design and
 * docs/01-architecture-overview.md §10's isolation model.
 *
 * A design detail the architecture docs simplified as "set by the connection
 * middleware at the start of every request" — found to be unsafe as literally
 * stated once connection pooling is accounted for. A plain `SET app.tenant_id`
 * on a pooled connection can leak across requests/tenants if the connection is
 * reused before the session variable is reset (exactly the failure mode RLS
 * exists to prevent). The correct, safe primitive is `set_config(name, value,
 * is_local => true)` — the RLS-safe equivalent of `SET LOCAL` — executed
 * inside the same transaction that runs the tenant-scoped queries, so the
 * setting is automatically and reliably scoped to that transaction only and
 * can never leak to the next request on a reused connection.
 *
 * Every tenant-scoped repository method is called with the `TenantScopedDb`
 * this produces, never with the raw `PrismaService` directly — that's what
 * makes RLS enforcement structural rather than "a middleware ran, hopefully."
 */
@Injectable()
export class TenantContextService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(tenantId: string, work: (db: TenantScopedDb) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return work(tx);
    });
  }
}
