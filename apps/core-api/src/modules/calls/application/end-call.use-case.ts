import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { assertValidCallStatusTransition } from "../domain/call-lifecycle";
import type { Call, CallStatus } from "../domain/call.entity";
import { CallNotFoundError } from "../domain/errors";
import {
  CALL_REPOSITORY,
  type CallRepository,
  type Db,
  type TranscriptTurn,
} from "../domain/ports/call-repository.port";

export interface EndCallCommand {
  tenantId: string;
  /** The telephony/runtime provider's own call identifier — the Voice Runtime never learns core-api's internal `Call.id`, only its own callId, so lookups key on this, not the primary key. */
  telephonyCallSid: string;
  status: Extract<CallStatus, "completed" | "abandoned">;
  endReason?: string | undefined;
  endedAt: string;
  /** Optional — see EndCallUseCase.persistTranscriptBestEffort for why a missing or failing transcript never blocks the call from ending. */
  transcript?: TranscriptTurn[] | undefined;
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
      // Before the early-return below: a repeat end-call delivery that
      // carries a transcript the first one didn't should still persist it.
      // saveTranscript is idempotent, so attempting it on every delivery
      // is safe and strictly better than only ever trying once.
      await this.persistTranscriptBestEffort(db, command, call.id);
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
   * BEST-EFFORT, and deliberately so: a transcript that fails to save
   * must never stop a call being marked ended. An unended call keeps its
   * capacity reservation held (up to the 4h TTL backstop) and leaves its
   * lifecycle open, which is a materially worse outcome than losing the
   * text of a conversation that has already happened.
   *
   * Logged at warn with the turn count so a silent, ongoing loss is
   * visible in logs rather than invisible — this table sat empty across
   * every real call before this path existed, and the only reason that
   * went unnoticed is that nothing ever complained.
   */
  private async persistTranscriptBestEffort(
    db: Db,
    command: EndCallCommand,
    callId: string,
  ): Promise<void> {
    if (!command.transcript || command.transcript.length === 0) {
      return;
    }
    try {
      const written = await this.callRepository.saveTranscript(
        db,
        command.tenantId,
        callId,
        command.transcript,
      );
      this.logger.info("call transcript persisted", {
        tenantId: command.tenantId,
        callId,
        turnsReceived: command.transcript.length,
        turnsWritten: written,
      });
    } catch (error) {
      this.logger.warn("call transcript failed to persist — ending the call regardless", {
        tenantId: command.tenantId,
        callId,
        turnsReceived: command.transcript.length,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
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
