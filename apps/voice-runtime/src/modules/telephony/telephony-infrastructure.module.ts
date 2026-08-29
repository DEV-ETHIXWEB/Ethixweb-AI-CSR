import { Module } from "@nestjs/common";
import { CALL_TRANSFER_PROVIDER } from "./domain/call-transfer.port";
import { TwilioCallTransferProvider } from "./infrastructure/twilio-call-transfer.provider";

/**
 * Separated from telephony.module.ts (which owns the inbound webhook
 * controller + Media Stream WS gateway) so call-session.module.ts can
 * depend on JUST the CallTransferProvider port without a circular module
 * dependency: telephony.module.ts's gateway needs CallSessionOrchestrator,
 * and CallSessionOrchestrator needs CallTransferProvider — those two facts
 * together would make telephony.module.ts and call-session.module.ts import
 * each other if this weren't split out.
 */
@Module({
  providers: [{ provide: CALL_TRANSFER_PROVIDER, useClass: TwilioCallTransferProvider }],
  exports: [CALL_TRANSFER_PROVIDER],
})
export class TelephonyInfrastructureModule {}
