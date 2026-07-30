import { ApiProperty } from "@nestjs/swagger";
import type { Customer } from "../../domain/customer.entity";

/** Deliberately omits `crmRawCache` — the vendor's raw cached record, an internal implementation detail never surfaced over the API (same discipline as CrmModule's CustomerResultResponseDto omitting `raw`). */
export class CustomerResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() businessId: string;
  @ApiProperty({ nullable: true }) crmCustomerId: string | null;
  @ApiProperty() phoneE164: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) email: string | null;
  @ApiProperty({ nullable: true }) address: Record<string, unknown> | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  private constructor(customer: Customer) {
    this.id = customer.id;
    this.tenantId = customer.tenantId;
    this.businessId = customer.businessId;
    this.crmCustomerId = customer.crmCustomerId;
    this.phoneE164 = customer.phoneE164;
    this.name = customer.name;
    this.email = customer.email;
    this.address = customer.address;
    this.createdAt = customer.createdAt;
    this.updatedAt = customer.updatedAt;
  }

  static fromDomain(customer: Customer): CustomerResponseDto {
    return new CustomerResponseDto(customer);
  }
}
