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
  /**
   * Compare-and-swap on `fromStatus`, same discipline as
   * PrismaLeadRepository's own `updateStatus` (leads/infrastructure/
   * prisma-lead.repository.ts) — an `updateMany({ where: { id, tenantId,
   * status: fromStatus } })`, never a blind `update()`. Returns `null`
   * (rather than throwing, unlike the Lead repository's own
   * ConcurrentLeadModificationError) when the row's status was no longer
   * `fromStatus` at write time, so EndCallUseCase can distinguish "another
   * request already landed the exact same target status" (a benign,
   * legitimate race — the Voice Runtime may signal call-ended twice) from
   * "another request landed a genuinely conflicting terminal status" (a
   * real 409) — a distinction the Lead repository's own callers don't need
   * to make the same way.
   */
  updateStatus(
    db: Db,
    tenantId: string,
    id: string,
    fromStatus: CallStatus,
    toStatus: CallStatus,
    fields: { endReason?: string | undefined; endedAt?: string | undefined },
  ): Promise<Call | null>;
  /** Dispatcher-facing call inbox + the dashboard's activeCallsCount/callsToday composition — filterable by status/createdAt, mirrors ListLeadsUseCase's own repository call exactly. */
  listByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListCallsOptions,
  ): Promise<ListCallsResult>;
  /**
   * Writes the conversation transcript for a finished call.
   *
   * IDEMPOTENT, but by an existence check rather than a unique
   * constraint: `Transcript` has only an INDEX on (call_id, turn_index),
   * not a UNIQUE, so `skipDuplicates` has nothing to key on. Adding that
   * constraint would mean another migration, and this schema's migrations
   * cannot run unmodified against Fly Managed Postgres (see
   * packages/database/scripts/fly-rls-policies.sql) — not a good trade
   * for a table written exactly once, wholesale, at end of call.
   *
   * The existence check is sufficient precisely because of that write
   * pattern: there is no partial-transcript case to merge. Matters
   * because the Voice Runtime may legitimately signal call-ended more
   * than once (retry, or both a caller-hangup and a call-ended event),
   * and EndCallUseCase is already idempotent for that same reason — the
   * transcript write must not be the one part of that path that
   * duplicates rows. Returns how many turns were newly written, so a
   * genuine no-op logs distinctly from a real save.
   */
  saveTranscript(
    db: Db,
    tenantId: string,
    callId: string,
    turns: TranscriptTurn[],
  ): Promise<number>;
}

export interface TranscriptTurn {
  turnIndex: number;
  speaker: string;
  text: string;
  confidence?: number | undefined;
  offsetMs?: number | undefined;
}

export const CALL_REPOSITORY = Symbol("CALL_REPOSITORY");
