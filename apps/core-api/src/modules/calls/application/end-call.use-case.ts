import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { assertValidCallStatusTransition } from "../domain/call-lifecycle";
import type { Call, CallStatus } from "../domain/call.entity";
import { CallNotFoundError } from "../domain/errors";
import { CALL_REPOSITORY, type CallRepository } from "../domain/ports/call-repository.port";

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
        command.status,
        {
          endReason: command.endReason,
          endedAt: command.endedAt,
        },
      );
      this.logger.info("call ended", {
        tenantId: updated.tenantId,
        callId: updated.id,
        status: updated.status,
      });
      return updated;
    });
  }
}
