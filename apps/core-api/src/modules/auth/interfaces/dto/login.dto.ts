import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";

// RFC 5321 §4.5.3.1.3 bounds an email address at 254 characters; 512 for
// password is generous headroom over any real password while still capping
// the input a client can force into a bcrypt comparison — an unbounded
// string here is a real (if minor) memory/CPU DoS surface, not just a
// correctness nicety, found during a security review pass.
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 512;

export class LoginDto {
  @ApiProperty({
    description:
      "The tenant this login is for — see LoginUseCase's own comment on why this is required, not inferred from email alone.",
  })
  @IsUUID()
  tenantId!: string;

  @ApiProperty({ example: "owner@allphaseplumbing.com" })
  @IsString()
  @MaxLength(MAX_EMAIL_LENGTH)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string;
}
