import { CallNotFoundError } from "../../../calls/domain/errors";
import type { Call } from "../../../calls/domain/call.entity";

/**
 * Stands in for CallsModule's GetCallUseCase — CreateLeadUseCase's own
 * comment explains why this is a real dependency now (the cross-tenant
 * callId vulnerability fix). Defaults to a call matching create-lead.use-case.spec.ts's
 * own `baseCommand()` fixture (tenant-1/business-1/call-1) so every
 * existing test in that file keeps passing unchanged; tests that need a
 * missing or wrong-business call seed/override explicitly.
 */
export class FakeGetCallUseCase {
  private readonly calls = new Map<string, Call>();

  constructor() {
    this.seed({
      id: "call-1",
      tenantId: "tenant-1",
      businessId: "business-1",
      customerId: "customer-1",
      direction: "inbound",
      fromNumber: "+15551234567",
      toNumber: "+15559876543",
      telephonyCallSid: "CAfake1",
      status: "in_progress",
      endReason: null,
      durationSeconds: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    });
  }

  async execute(tenantId: string, callId: string): Promise<Call> {
    const call = this.calls.get(callId);
    if (!call || call.tenantId !== tenantId) {
      throw new CallNotFoundError(callId);
    }
    return call;
  }

  /** Test helper — seed or overwrite a call directly. */
  seed(call: Call): void {
    this.calls.set(call.id, call);
  }

  /** Test helper — remove a call, simulating "never started". */
  remove(callId: string): void {
    this.calls.delete(callId);
  }
}
