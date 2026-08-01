import { ApiProperty } from "@nestjs/swagger";
import type { BusinessHoursResult } from "../../domain/business-hour.entity";

export class BusinessHoursResponseDto {
  @ApiProperty() isOpen: boolean;
  @ApiProperty({ nullable: true }) opensAt: string | null;
  @ApiProperty() isHoliday: boolean;

  private constructor(result: BusinessHoursResult) {
    this.isOpen = result.isOpen;
    this.opensAt = result.opensAt;
    this.isHoliday = result.isHoliday;
  }

  static fromDomain(result: BusinessHoursResult): BusinessHoursResponseDto {
    return new BusinessHoursResponseDto(result);
  }
}
