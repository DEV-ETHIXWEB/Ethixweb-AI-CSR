import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { assertValidCallStatusTransition } from "../domain/call-lifecycle";
import type { Call, CallStatus } from "../domain/call.entity";
import { CallNotFoundError } from "../domain/errors";
import { CALL_REPOSITORY, type CallRepository, type Db } from "../domain/ports/call-repository.port";

export interface EndCallCommand {
  tenantId: string;
  /** The telephony/runtime provider's own call identifier — the Voice Runtime never learns core-api's internal `Call.id`, only its own callId, so lookups key on this, not the primary key. */
  telephonyCallSid: string;
  status: Extract<CallStatus, "completed" | "abandoned">;
  endReason?: string | undefined;
  endedAt: string;
}

/**
 * Idempotent by the same convention as EndConversationUseCase
 * (voice-orchestrator) and RequeueNotificationUseCase: a call already in a
 * terminal status returns unchanged rather than erroring — the Voice
 * Runtime may legitimately signal call-ended more than once (retry, or
 * both a caller-hangup and a call-ended event). "Call ends before a lead
 * exists" and "call never produces a lead" are both handled by construction
 * here: nothing about ending a call requires a Lead row to exist, and
 * ending a call never touches/blocks Lead creation in either direction.
 *
 * Race-safe against two CONCURRENT end-call signals with DIFFERENT terminal
 * statuses (e.g. a normal "completed" and a "abandoned" disconnect signal
 * arriving at nearly the same instant) — a real, previously-shipped bug
 * found live: the read-then-write below is not by itself atomic, so
 * `callRepository.updateStatus` compare-and-swaps on the status this
 * request actually read (`call.status`), same discipline as
 * PrismaLeadRepository's own `updateStatus`/ConcurrentLeadModificationError
 * (leads/infrastructure/prisma-lead.repository.ts). A `null` result means
 * a concurrent request already changed the status first; the single
 * re-read below resolves it exactly like a fresh call to this use-case
 * would (idempotent no-op if the concurrent winner landed the SAME target
 * status, IllegalCallStatusTransitionError if it landed a different one) —
 * terminal statuses have no further outgoing transitions
 * (call-lifecycle.ts's own ALLOWED_TRANSITIONS), so that re-read can never
 * itself be stale enough to need a second retry.
 */
@Injectable()
export class EndCallUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CALL_REPOSITORY) private readonly callRepository: CallRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: EndCallCommand): Promise<Call> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.telephony_call_sid": command.telephonyCallSid,
    });

    return this.tenantContext.run(command.tenantId, async (db) => {
      const call = await this.callRepository.findByTelephonyCallSid(
        db,
        command.tenantId,
        command.telephonyCallSid,
      );
      if (!call) {
        throw new CallNotFoundError(command.telephonyCallSid);
      }
      if (call.status === command.status) {
        return call;
      }
      assertValidCallStatusTransition(call.status, command.status);

      const updated = await this.callRepository.updateStatus(
        db,
        command.tenantId,
        call.id,
        call.status,
        command.status,
        {
          endReason: command.endReason,
          endedAt: command.endedAt,
        },
      );
      if (updated === null) {
        return this.resolveLostRace(db, command, call.id);
      }
      this.logger.info("call ended", {
        tenantId: updated.tenantId,
        callId: updated.id,
        status: updated.status,
      });
      return updated;
    });
  }

  /**
   * A concurrent request already changed the call's status before this
   * request's CAS write landed. Re-reads and resolves it exactly like a
   * fresh call to this use-case would — see this class's own comment for
   * why a single re-read (no retry loop) is sufficient.
   */
  private async resolveLostRace(db: Db, command: EndCallCommand, callId: string): Promise<Call> {
    const latest = await this.callRepository.findById(db, command.tenantId, callId);
    if (!latest) {
      throw new CallNotFoundError(command.telephonyCallSid);
    }
    if (latest.status === command.status) {
      return latest;
    }
    assertValidCallStatusTransition(latest.status, command.status);
    return latest;
  }
}
