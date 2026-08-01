import { ApiProperty } from "@nestjs/swagger";
import type { SmsClaimReplyOutcome } from "../../application/handle-sms-claim-reply.use-case";

export class SmsClaimReplyResponseDto {
  @ApiProperty() status: SmsClaimReplyOutcome["status"];
  @ApiProperty({ nullable: true }) leadId: string | null;

  private constructor(outcome: SmsClaimReplyOutcome) {
    this.status = outcome.status;
    this.leadId = "leadId" in outcome ? outcome.leadId : null;
  }

  static fromDomain(outcome: SmsClaimReplyOutcome): SmsClaimReplyResponseDto {
    return new SmsClaimReplyResponseDto(outcome);
  }
}
