import { ApiProperty } from "@nestjs/swagger";
import type { Lead, LeadStatus } from "../../domain/lead.entity";

export class LeadResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() businessId: string;
  @ApiProperty() customerId: string;
  @ApiProperty() callId: string;
  @ApiProperty({ nullable: true }) crmLeadId: string | null;
  @ApiProperty() problemSummary: string;
  @ApiProperty() priority: string;
  @ApiProperty() leadType: string;
  @ApiProperty() status: LeadStatus;
  @ApiProperty({ type: "object", additionalProperties: true }) qualificationData: Record<
    string,
    unknown
  >;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  private constructor(lead: Lead) {
    this.id = lead.id;
    this.tenantId = lead.tenantId;
    this.businessId = lead.businessId;
    this.customerId = lead.customerId;
    this.callId = lead.callId;
    this.crmLeadId = lead.crmLeadId;
    this.problemSummary = lead.problemSummary;
    this.priority = lead.priority;
    this.leadType = lead.leadType;
    this.status = lead.status;
    this.qualificationData = lead.qualificationData;
    this.createdAt = lead.createdAt;
    this.updatedAt = lead.updatedAt;
  }

  static fromDomain(lead: Lead): LeadResponseDto {
    return new LeadResponseDto(lead);
  }
}
