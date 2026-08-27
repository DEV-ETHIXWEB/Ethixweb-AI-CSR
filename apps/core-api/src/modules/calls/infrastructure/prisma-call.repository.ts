import { Injectable } from "@nestjs/common";
import { Prisma } from "@ethixweb/database";
import { CallAlreadyExistsError } from "../domain/errors";
import type { Call, CallDirection, CallStatus } from "../domain/call.entity";
import type {
  CallRepository,
  CreateCallInput,
  Db,
  ListCallsOptions,
  ListCallsResult,
} from "../domain/ports/call-repository.port";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

type CallRow = {
  id: string;
  tenantId: string;
  businessId: string;
  customerId: string | null;
  direction: string;
  fromNumber: string;
  toNumber: string;
  telephonyCallSid: string;
  status: string;
  endReason: string | null;
  durationSeconds: number | null;
  startedAt: Date;
  endedAt: Date | null;
};

function toEntity(row: CallRow): Call {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    customerId: row.customerId,
    direction: row.direction as CallDirection,
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    telephonyCallSid: row.telephonyCallSid,
    status: row.status as CallStatus,
    endReason: row.endReason,
    durationSeconds: row.durationSeconds,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class PrismaCallRepository implements CallRepository {
  async create(db: Db, input: CreateCallInput): Promise<Call> {
    // A unique-constraint violation is a real Postgres error, not just a
    // caught JS exception — it poisons the REST of the enclosing
    // transaction (25P02 "current transaction is aborted") until a
    // ROLLBACK. StartCallUseCase's own catch-and-refetch runs
    // findByTelephonyCallSid against this SAME transaction (db is the
    // shared TenantContextService.run() tx, needed so app.tenant_id stays
    // set for RLS) — without a savepoint here, that refetch would itself
    // fail with 25P02, discovered by a real-Postgres integration test
    // (unit tests against the fake repository never hit real transaction
    // semantics, so this was invisible until then). SAVEPOINT/ROLLBACK TO
    // SAVEPOINT scopes the failure to just this INSERT, leaving the outer
    // transaction healthy for the caller's subsequent query.
    await db.$executeRaw`SAVEPOINT create_call`;
    try {
      const row = await db.call.create({
        data: {
          tenantId: input.tenantId,
          businessId: input.businessId,
          customerId: input.customerId,
          direction: input.direction,
          fromNumber: input.fromNumber,
          toNumber: input.toNumber,
          telephonyCallSid: input.telephonyCallSid,
          status: "in_progress",
          startedAt: new Date(input.startedAt),
        },
      });
      await db.$executeRaw`RELEASE SAVEPOINT create_call`;
      return toEntity(row);
    } catch (error) {
      await db.$executeRaw`ROLLBACK TO SAVEPOINT create_call`;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new CallAlreadyExistsError(input.telephonyCallSid);
      }
      throw error;
    }
  }

  async findById(db: Db, tenantId: string, id: string): Promise<Call | null> {
    const row = await db.call.findFirst({ where: { id, tenantId } });
    return row ? toEntity(row) : null;
  }

  async findByTelephonyCallSid(
    db: Db,
    tenantId: string,
    telephonyCallSid: string,
  ): Promise<Call | null> {
    const row = await db.call.findFirst({ where: { tenantId, telephonyCallSid } });
    return row ? toEntity(row) : null;
  }

  async updateStatus(
    db: Db,
    tenantId: string,
    id: string,
    status: CallStatus,
    fields: { endReason?: string | undefined; endedAt?: string | undefined },
  ): Promise<Call> {
    const existing = await db.call.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new Error(
        `PrismaCallRepository.updateStatus: no call ${id} found for tenant ${tenantId}`,
      );
    }

    const endedAt = fields.endedAt !== undefined ? new Date(fields.endedAt) : undefined;
    const durationSeconds =
      endedAt !== undefined
        ? Math.max(0, Math.round((endedAt.getTime() - existing.startedAt.getTime()) / 1000))
        : undefined;

    const { count } = await db.call.updateMany({
      where: { id, tenantId },
      data: {
        status,
        ...(fields.endReason !== undefined ? { endReason: fields.endReason } : {}),
        ...(endedAt !== undefined ? { endedAt } : {}),
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      },
    });
    if (count === 0) {
      throw new Error(
        `PrismaCallRepository.updateStatus: no call ${id} found for tenant ${tenantId}`,
      );
    }
    const updated = await db.call.findFirst({ where: { id, tenantId } });
    if (!updated) {
      throw new Error(`PrismaCallRepository.updateStatus: call ${id} vanished after update`);
    }
    return toEntity(updated);
  }

  async listByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListCallsOptions,
  ): Promise<ListCallsResult> {
    const where: Prisma.CallWhereInput = {
      tenantId,
      businessId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.createdAfter || options.createdBefore
        ? {
            startedAt: {
              ...(options.createdAfter ? { gte: options.createdAfter } : {}),
              ...(options.createdBefore ? { lte: options.createdBefore } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      db.call.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      db.call.count({ where }),
    ]);

    return { items: rows.map(toEntity), total };
  }
}
