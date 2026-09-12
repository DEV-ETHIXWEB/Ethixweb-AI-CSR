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
  TranscriptTurn,
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
    fromStatus: CallStatus,
    toStatus: CallStatus,
    fields: { endReason?: string | undefined; endedAt?: string | undefined },
  ): Promise<Call | null> {
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

    // Compare-and-swap on `fromStatus` — see this method's own port comment
    // (call-repository.port.ts) for why: a blind `updateMany({ where: {
    // id, tenantId } })` here (the previous implementation) let two
    // concurrent EndCall requests with different terminal statuses both
    // read status="in_progress", both pass the domain transition check,
    // and both write — whichever committed last silently overwrote the
    // other's terminal status with no error, corrupting the call's final
    // outcome. `count === 0` here means a concurrent writer already moved
    // the row off `fromStatus` before this write landed.
    const { count } = await db.call.updateMany({
      where: { id, tenantId, status: fromStatus },
      data: {
        status: toStatus,
        ...(fields.endReason !== undefined ? { endReason: fields.endReason } : {}),
        ...(endedAt !== undefined ? { endedAt } : {}),
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      },
    });
    if (count === 0) {
      return null;
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

  async saveTranscript(
    db: Db,
    tenantId: string,
    callId: string,
    turns: TranscriptTurn[],
  ): Promise<number> {
    if (turns.length === 0) {
      return 0;
    }

    // See CallRepository.saveTranscript's own comment for why this is an
    // existence check and not an upsert: the transcript is written once,
    // wholesale, at end of call, so "some rows already here" can only
    // mean a repeat delivery — never a partial transcript to merge.
    const existing = await db.transcript.count({ where: { tenantId, callId } });
    if (existing > 0) {
      return 0;
    }

    const created = await db.transcript.createMany({
      data: turns.map((turn) => ({
        tenantId,
        callId,
        turnIndex: turn.turnIndex,
        speaker: turn.speaker,
        text: turn.text,
        // `offset_ms` is NOT NULL in the schema, and the orchestrator does
        // not currently populate a real per-turn offset — 0 is an honest
        // "unknown", and turnIndex already carries the ordering the
        // column would otherwise be read for.
        offsetMs: turn.offsetMs ?? 0,
        ...(turn.confidence === undefined ? {} : { confidence: turn.confidence }),
      })),
    });

    return created.count;
  }
}
