/** Everything the WebSocket `start` event needs to have carried over from the webhook (docs/28 §B.1's required start fields, plus Twilio's own callSid/streamSid) — see twiml.builder.ts's own comment on why this round-trips via Stream <Parameter>s rather than being available any other way. */
export interface CallSessionParams {
  callId: string;
  tenantId: string;
  businessId: string;
  callerAni: string;
  toNumber?: string | undefined;
  timezone?: string | undefined;
  callSid: string;
  streamSid: string;
}

/** The tool allowlist this runtime passes on every turn — docs/28 §B.2's full 8-tool set, not a subset. voice-orchestrator's own ExecuteToolUseCase is the actual authorization gate (docs/04 §2 stage 2); this runtime does not need to know which tools are appropriate for which conversation state. */
export const ALLOWED_TOOLS = [
  "searchCustomer",
  "createCustomer",
  "createLead",
  "updateLead",
  "getBusinessHours",
  "getServiceAreas",
  "escalateEmergency",
  "lookupPreviousCalls",
  // Missing until 2026-10-14: without it the model was never offered the
  // tool on a real call, guessed its arguments from the prompt, and every
  // "can I talk to a person" was rejected (testers Yash and Prateek, three
  // failed transfers in one afternoon). The QA harness enables every tool,
  // which is why it never showed there.
  "transferToHuman",
] as const;
