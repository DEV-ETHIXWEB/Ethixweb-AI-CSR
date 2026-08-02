import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { CallAlreadyExistsError } from "../domain/errors";
import type { Call, CallDirection } from "../domain/call.entity";
import { CALL_REPOSITORY, type CallRepository } from "../domain/ports/call-repository.port";

export interface StartCallCommand {
  tenantId: string;
  businessId: string;
  customerId?: string | undefined;
  direction: CallDirection;
  fromNumber: string;
  toNumber: string;
  /** The telephony/runtime provider's own call identifier — the idempotency key, see this module's errors.ts. */
  telephonyCallSid: string;
  startedAt: string;
}

/**
 * The production-blocker fix: this is the ONLY place a `Call` row is ever
 * created, and it must run before anything downstream (createLead) can
 * reference that call's id. Idempotent on `telephonyCallSid` — a duplicated
 * `call.started` delivery from the Voice Runtime/telephony provider (a
 * retry, a webhook redelivered) returns the EXISTING row rather than
 * creating a second one or erroring, the same `UNIQUE` constraint +
 * catch-and-refetch discipline `CreateLeadUseCase` already established for
 * `Lead.callId`.
 */
@Injectable()
export class StartCallUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CALL_REPOSITORY) private readonly callRepository: CallRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: StartCallCommand): Promise<Call> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    return this.tenantContext.run(command.tenantId, async (db) => {
      try {
        const call = await this.callRepository.create(db, {
          tenantId: command.tenantId,
          businessId: command.businessId,
          customerId: command.customerId ?? null,
          direction: command.direction,
          fromNumber: command.fromNumber,
          toNumber: command.toNumber,
          telephonyCallSid: command.telephonyCallSid,
          startedAt: command.startedAt,
        });
        this.logger.info("call started", {
          tenantId: call.tenantId,
          callId: call.id,
          telephonyCallSid: call.telephonyCallSid,
        });
        return call;
      } catch (error) {
        if (!(error instanceof CallAlreadyExistsError)) {
          throw error;
        }
        const existing = await this.callRepository.findByTelephonyCallSid(
          db,
          command.tenantId,
          command.telephonyCallSid,
        );
        if (!existing) {
          throw new Error(
            `StartCallUseCase: constraint violation for telephonyCallSid "${command.telephonyCallSid}" but no row found on re-fetch`,
          );
        }
        this.logger.info("call.started replayed — returned the existing call", {
          tenantId: existing.tenantId,
          callId: existing.id,
          telephonyCallSid: existing.telephonyCallSid,
        });
        return existing;
      }
    });
  }
}
