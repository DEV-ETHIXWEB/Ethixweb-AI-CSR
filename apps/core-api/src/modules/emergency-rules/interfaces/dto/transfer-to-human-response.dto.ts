import { ApiProperty } from "@nestjs/swagger";
import type { TransferToHumanResult } from "../../application/transfer-to-human.use-case";

export class TransferToHumanResponseDto {
  @ApiProperty({ nullable: true }) transferDestination: string | null;

  private constructor(result: TransferToHumanResult) {
    this.transferDestination = result.transferDestination;
  }

  static fromDomain(result: TransferToHumanResult): TransferToHumanResponseDto {
    return new TransferToHumanResponseDto(result);
  }
}
