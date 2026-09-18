import type { CallTransferProvider } from "../../domain/call-transfer.port";

export class FakeCallTransferProvider implements CallTransferProvider {
  readonly transferCalls: Array<{ callSid: string; destination: string }> = [];
  failNextWith: Error | null = null;

  async transferCall(callSid: string, destination: string): Promise<void> {
    this.transferCalls.push({ callSid, destination });
    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = null;
      throw error;
    }
  }

  readonly hangUps: string[] = [];
  failNextHangUpWith: Error | null = null;

  async hangUp(callSid: string): Promise<void> {
    this.hangUps.push(callSid);
    if (this.failNextHangUpWith) {
      const error = this.failNextHangUpWith;
      this.failNextHangUpWith = null;
      throw error;
    }
  }
}
