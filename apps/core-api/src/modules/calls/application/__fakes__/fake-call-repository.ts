import { randomUUID } from "node:crypto";
import type { Call } from "../../domain/call.entity";
import { CallAlreadyExistsError } from "../../domain/errors";
import type {
  CallRepository,
  CreateCallInput,
  Db,
  ListCallsOptions,
  ListCallsResult,
} from "../../domain/ports/call-repository.port";

export class FakeCallRepository implements CallRepository {
  private readonly calls = new Map<string, Call>();

  async create(_db: Db, input: CreateCallInput): Promise<Call> {
    for (const existing of this.calls.values()) {
      if (
        existing.tenantId === input.tenantId &&
        existing.telephonyCallSid === input.telephonyCallSid
      ) {
        throw new CallAlreadyExistsError(input.telephonyCallSid);
      }
    }
    const call: Call = {
      id: randomUUID(),
      tenantId: input.tenantId,
      businessId: input.businessId,
      customerId: input.customerId,
      direction: input.direction,
      fromNumber: input.fromNumber,
      toNumber: input.toNumber,
      telephonyCallSid: input.telephonyCallSid,
      status: "in_progress",
      endReason: null,
      durationSeconds: null,
      startedAt: input.startedAt,
      endedAt: null,
    };
    this.calls.set(call.id, call);
    return call;
  }

  async findById(_db: Db, tenantId: string, id: string): Promise<Call | null> {
    const call = this.calls.get(id);
    return call && call.tenantId === tenantId ? call : null;
  }

  async findByTelephonyCallSid(
    _db: Db,
    tenantId: string,
    telephonyCallSid: string,
  ): Promise<Call | null> {
    for (const call of this.calls.values()) {
      if (call.tenantId === tenantId && call.telephonyCallSid === telephonyCallSid) {
        return call;
      }
    }
    return null;
  }

  async updateStatus(
    _db: Db,
    tenantId: string,
    id: string,
    status: Call["status"],
    fields: { endReason?: string | undefined; endedAt?: string | undefined },
  ): Promise<Call> {
    const existing = this.calls.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`FakeCallRepository: no call ${id} for tenant ${tenantId}`);
    }
    const durationSeconds =
      fields.endedAt !== undefined
        ? Math.max(
            0,
            Math.round(
              (new Date(fields.endedAt).getTime() - new Date(existing.startedAt).getTime()) / 1000,
            ),
          )
        : existing.durationSeconds;
    const updated: Call = {
      ...existing,
      status,
      endReason: fields.endReason ?? existing.endReason,
      endedAt: fields.endedAt ?? existing.endedAt,
      durationSeconds,
    };
    this.calls.set(id, updated);
    return updated;
  }

  async listByBusiness(
    _db: Db,
    tenantId: string,
    businessId: string,
    options: ListCallsOptions,
  ): Promise<ListCallsResult> {
    let matches = [...this.calls.values()].filter(
      (call) => call.tenantId === tenantId && call.businessId === businessId,
    );
    if (options.status) {
      matches = matches.filter((call) => call.status === options.status);
    }
    if (options.createdAfter) {
      const after = options.createdAfter;
      matches = matches.filter((call) => new Date(call.startedAt) >= after);
    }
    if (options.createdBefore) {
      const before = options.createdBefore;
      matches = matches.filter((call) => new Date(call.startedAt) <= before);
    }
    matches.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const start = (options.page - 1) * options.pageSize;
    return { items: matches.slice(start, start + options.pageSize), total: matches.length };
  }

  /** Test helper. */
  seed(call: Call): void {
    this.calls.set(call.id, call);
  }
}
