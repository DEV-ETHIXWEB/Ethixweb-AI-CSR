import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/** See RefreshLeadCallerUseCase. */
export class RefreshLeadCallerToolDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty({ description: "The telephony call id, as createLead takes it." })
  @IsUUID()
  callId!: string;
}
