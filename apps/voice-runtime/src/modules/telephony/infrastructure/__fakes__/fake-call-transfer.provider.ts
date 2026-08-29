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
}
