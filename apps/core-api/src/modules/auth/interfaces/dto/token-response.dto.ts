import { ApiProperty } from "@nestjs/swagger";
import type { LoginResult } from "../../application/commands/login.use-case";
import { UserResponseDto } from "./user-response.dto";

export class TokenResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ type: UserResponseDto }) user: UserResponseDto;

  private constructor(result: LoginResult) {
    this.accessToken = result.accessToken;
    this.refreshToken = result.refreshToken;
    this.user = UserResponseDto.fromDomain(result.user);
  }

  static fromDomain(result: LoginResult): TokenResponseDto {
    return new TokenResponseDto(result);
  }
}

export class RefreshedTokenResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;

  constructor(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }
}
