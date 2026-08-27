import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { Call, CallDirection, CallStatus } from "../call.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateCallInput {
  tenantId: string;
  businessId: string;
  customerId: string | null;
  direction: CallDirection;
  fromNumber: string;
  toNumber: string;
  telephonyCallSid: string;
  startedAt: string;
}

/**
 * Mirrors ListLeadsOptions's shape (leads/domain/ports/lead-repository.port.ts),
 * with one deliberate deviation: `Call` has no `createdAt` column at all
 * (see packages/database/prisma/schema.prisma's `Call` model — only
 * `startedAt`, which IS `@default(now())` and IS the indexed column,
 * `@@index([businessId, startedAt])`). `createdAfter`/`createdBefore` here
 * filter on `startedAt` as the natural equivalent for a telephony-driven
 * entity, not a separate, nonexistent column.
 */
export interface ListCallsOptions {
  page: number;
  pageSize: number;
  status?: CallStatus | undefined;
  createdAfter?: Date | undefined;
  createdBefore?: Date | undefined;
}

export interface ListCallsResult {
  items: Call[];
  total: number;
}

export interface CallRepository {
  /** Throws {@link CallAlreadyExistsError} on a `UNIQUE(telephony_call_sid)` violation — the idempotency backstop for a duplicated `call.started` delivery, identical discipline to Lead's own `UNIQUE(call_id)` race handling. */
  create(db: Db, input: CreateCallInput): Promise<Call>;
  findById(db: Db, tenantId: string, id: string): Promise<Call | null>;
  findByTelephonyCallSid(db: Db, tenantId: string, telephonyCallSid: string): Promise<Call | null>;
  updateStatus(
    db: Db,
    tenantId: string,
    id: string,
    status: CallStatus,
    fields: { endReason?: string | undefined; endedAt?: string | undefined },
  ): Promise<Call>;
  /** Dispatcher-facing call inbox + the dashboard's activeCallsCount/callsToday composition — filterable by status/createdAt, mirrors ListLeadsUseCase's own repository call exactly. */
  listByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListCallsOptions,
  ): Promise<ListCallsResult>;
}

export const CALL_REPOSITORY = Symbol("CALL_REPOSITORY");
