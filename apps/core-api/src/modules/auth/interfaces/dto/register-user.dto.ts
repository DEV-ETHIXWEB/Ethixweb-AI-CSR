import { ApiProperty } from "@nestjs/swagger";
import type { UserRole } from "@ethixweb/database";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

/** Mirrors the UserRole enum — docs/08-security-observability-reliability.md §1.1. */
export const USER_ROLES = [
  "owner",
  "admin",
  "dispatcher",
  "viewer",
] as const satisfies readonly UserRole[];

// See login.dto.ts for why these bounds exist (RFC 5321 email length,
// unbounded-input DoS surface on a field that reaches bcrypt).
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 512;

export class RegisterUserDto {
  @ApiProperty({ example: "dispatcher@allphaseplumbing.com" })
  @IsString()
  @MaxLength(MAX_EMAIL_LENGTH)
  email!: string;

  @ApiProperty({ description: "Minimum 12 characters — see PasswordHash's own policy comment." })
  @IsString()
  @MinLength(12)
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string;

  @ApiProperty({ enum: USER_ROLES })
  @IsIn(USER_ROLES)
  role!: UserRole;
}
