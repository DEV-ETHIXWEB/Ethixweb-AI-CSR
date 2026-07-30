import { ApiProperty } from "@nestjs/swagger";
import type { ListCustomersResult } from "../../domain/ports/customer-repository.port";
import { CustomerResponseDto } from "./customer-response.dto";

export class PaginatedCustomersResponseDto {
  @ApiProperty({ type: [CustomerResponseDto] }) items: CustomerResponseDto[];
  @ApiProperty() total: number;

  private constructor(result: ListCustomersResult) {
    this.items = result.items.map((customer) => CustomerResponseDto.fromDomain(customer));
    this.total = result.total;
  }

  static fromDomain(result: ListCustomersResult): PaginatedCustomersResponseDto {
    return new PaginatedCustomersResponseDto(result);
  }
}
