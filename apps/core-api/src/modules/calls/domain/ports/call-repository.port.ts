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
}

export const CALL_REPOSITORY = Symbol("CALL_REPOSITORY");
