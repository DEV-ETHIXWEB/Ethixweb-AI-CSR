import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength } from "class-validator";

// A real JWT with the claims this platform issues is well under 1KB;
// generous headroom over that while still bounding the input before it
// reaches jsonwebtoken's own parsing.
const MAX_TOKEN_LENGTH = 4096;

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @MaxLength(MAX_TOKEN_LENGTH)
  refreshToken!: string;
}
