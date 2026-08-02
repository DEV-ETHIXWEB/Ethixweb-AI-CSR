import { ApiProperty } from "@nestjs/swagger";
import type { Call } from "../../domain/call.entity";

export class CallResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() businessId: string;
  @ApiProperty({ nullable: true }) customerId: string | null;
  @ApiProperty() direction: string;
  @ApiProperty() fromNumber: string;
  @ApiProperty() toNumber: string;
  @ApiProperty() telephonyCallSid: string;
  @ApiProperty() status: string;
  @ApiProperty({ nullable: true }) endReason: string | null;
  @ApiProperty({ nullable: true }) durationSeconds: number | null;
  @ApiProperty() startedAt: string;
  @ApiProperty({ nullable: true }) endedAt: string | null;

  private constructor(call: Call) {
    this.id = call.id;
    this.tenantId = call.tenantId;
    this.businessId = call.businessId;
    this.customerId = call.customerId;
    this.direction = call.direction;
    this.fromNumber = call.fromNumber;
    this.toNumber = call.toNumber;
    this.telephonyCallSid = call.telephonyCallSid;
    this.status = call.status;
    this.endReason = call.endReason;
    this.durationSeconds = call.durationSeconds;
    this.startedAt = call.startedAt;
    this.endedAt = call.endedAt;
  }

  static fromDomain(call: Call): CallResponseDto {
    return new CallResponseDto(call);
  }
}
