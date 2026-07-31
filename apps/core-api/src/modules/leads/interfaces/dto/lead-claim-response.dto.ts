import { ApiProperty } from "@nestjs/swagger";
import type { ClaimLeadResult } from "../../application/claim-lead.use-case";
import { LeadResponseDto } from "./lead-response.dto";

export class LeadClaimResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() leadId: string;
  @ApiProperty() claimedByUserId: string;
  @ApiProperty() claimMethod: string;
  @ApiProperty() claimedAt: Date;

  private constructor(result: ClaimLeadResult) {
    this.id = result.claim.id;
    this.leadId = result.claim.leadId;
    this.claimedByUserId = result.claim.claimedByUserId;
    this.claimMethod = result.claim.claimMethod;
    this.claimedAt = result.claim.claimedAt;
  }

  static fromDomain(result: ClaimLeadResult): LeadClaimResponseDto {
    return new LeadClaimResponseDto(result);
  }
}

export class ClaimLeadResultResponseDto {
  @ApiProperty() lead: LeadResponseDto;
  @ApiProperty() claim: LeadClaimResponseDto;

  private constructor(result: ClaimLeadResult) {
    this.lead = LeadResponseDto.fromDomain(result.lead);
    this.claim = LeadClaimResponseDto.fromDomain(result);
  }

  static fromDomain(result: ClaimLeadResult): ClaimLeadResultResponseDto {
    return new ClaimLeadResultResponseDto(result);
  }
}
