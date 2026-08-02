import { Injectable } from "@nestjs/common";
import { Prisma } from "@ethixweb/database";
import { CallAlreadyExistsError } from "../domain/errors";
import type { Call, CallDirection, CallStatus } from "../domain/call.entity";
import type { CallRepository, CreateCallInput, Db } from "../domain/ports/call-repository.port";

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
}
