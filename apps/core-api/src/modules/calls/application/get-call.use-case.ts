import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Call } from "../domain/call.entity";
import { CallNotFoundError } from "../domain/errors";
import { CALL_REPOSITORY, type CallRepository } from "../domain/ports/call-repository.port";

@Injectable()
export class GetCallUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CALL_REPOSITORY) private readonly callRepository: CallRepository,
  ) {}

  async execute(tenantId: string, callId: string): Promise<Call> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.call_id": callId });
    const call = await this.tenantContext.run(tenantId, (db) =>
      this.callRepository.findById(db, tenantId, callId),
    );
    if (!call) {
      throw new CallNotFoundError(callId);
    }
    return call;
  }

  /**
   * A DIFFERENT lookup from `execute` above, not an alias — `execute`
   * resolves the Call's own internal `id` (the DB primary key), the
   * identifier a dashboard viewing `/calls/:id` actually has. Every
   * caller INSIDE the voice pipeline (voice-orchestrator's Conversation,
   * every AI tool call's `call_id` argument) only ever knows the
   * telephony-level id instead — `StartConversationUseCase` awaits
   * `POST /internal/calls` before the conversation is created, but
   * discards its response, so the real internal `Call.id` it returns
   * never reaches voice-orchestrator at all. Found live: CreateLeadUseCase
   * was calling `execute(tenantId, command.callId)` with that telephony
   * id, comparing it against `id` — two disjoint UUID spaces (`Call.id`
   * is `@default(uuid())`, `telephonyCallSid` is a separate `@unique`
   * column) — so the lookup 404'd on every single real call, every time,
   * not intermittently: a real prospective client's lead silently never
   * got created. `findByTelephonyCallSid` already existed for
   * StartCallUseCase's own idempotency-recovery path; this just gives
   * CreateLeadUseCase the correctly-keyed equivalent instead of reusing
   * `execute`'s by-id lookup for a value that was never a by-id key.
   */
  async executeByTelephonyCallSid(tenantId: string, telephonyCallSid: string): Promise<Call> {
    setSpanAttributes({
      "ethixweb.tenant_id": tenantId,
      "ethixweb.telephony_call_sid": telephonyCallSid,
    });
    const call = await this.tenantContext.run(tenantId, (db) =>
      this.callRepository.findByTelephonyCallSid(db, tenantId, telephonyCallSid),
    );
    if (!call) {
      throw new CallNotFoundError(telephonyCallSid);
    }
    return call;
  }
}
