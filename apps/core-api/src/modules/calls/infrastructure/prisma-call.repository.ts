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
      return toEntity(row);
    } catch (error) {
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
}
