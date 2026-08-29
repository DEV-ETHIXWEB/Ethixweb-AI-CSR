/**
 * Executes the ACTUAL transfer docs/28 §M signals but never performs —
 * "this backend only signals, never executes, a transfer... you are
 * responsible for executing the actual SIP transfer" (now this service,
 * per this build's scope, previously "Yash's" per docs/30). [Unverified
 * against a live SIP trunk/Twilio account — see docs/33's own tracking for
 * this specific step.]
 */
export interface CallTransferProvider {
  /** Redirects an in-progress Twilio call to dial `destination` (E.164), replacing the Media Stream connection entirely — the caller leaves this service's control once this succeeds. */
  transferCall(callSid: string, destination: string): Promise<void>;
}

export const CALL_TRANSFER_PROVIDER = Symbol("CALL_TRANSFER_PROVIDER");
