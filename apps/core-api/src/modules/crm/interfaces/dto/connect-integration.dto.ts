import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsUUID, ValidateNested } from "class-validator";
import { CrmCredentialDto } from "./crm-credential.dto";

export const CRM_TYPES = [
  "housecall_pro",
  "service_titan",
  "jobber",
  "service_fusion",
  "field_edge",
] as const;

export class ConnectIntegrationDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty({ enum: CRM_TYPES })
  @IsIn(CRM_TYPES)
  crmType!: (typeof CRM_TYPES)[number];

  @ApiProperty({ type: CrmCredentialDto })
  @ValidateNested()
  @Type(() => CrmCredentialDto)
  credential!: CrmCredentialDto;
}
