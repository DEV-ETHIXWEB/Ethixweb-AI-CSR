import { NotFoundDomainError } from "../../../shared/domain/domain-error";

export class CallNotFoundError extends NotFoundDomainError {
  constructor(public readonly callId: string) {
    super(`Call not found: ${callId}`);
    this.name = "CallNotFoundError";
  }
}

/**
 * Internal control-flow signal, NOT a DomainError — mirrors
 * LeadCallIdAlreadyExistsError exactly, for the same reason: hitting the
 * `UNIQUE(telephony_call_sid)` constraint concurrently is the DOCUMENTED
 * idempotency mechanism for call creation (a duplicate `call.started`
 * delivery from the Voice Runtime/telephony provider must never create a
 * second `Call` row), never an error a caller should see.
 * StartCallUseCase always catches this internally; if it ever escapes
 * uncaught, that's a real bug worth a loud, generic 500.
 */
export class CallAlreadyExistsError extends Error {
  constructor(public readonly telephonyCallSid: string) {
    super(`A call already exists for telephonyCallSid ${telephonyCallSid}.`);
    this.name = "CallAlreadyExistsError";
  }
}
