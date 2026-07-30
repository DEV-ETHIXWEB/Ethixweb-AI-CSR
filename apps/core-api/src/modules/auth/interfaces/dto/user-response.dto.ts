import { ApiProperty } from "@nestjs/swagger";
import type { PublicUser } from "../../domain/user.entity";

/** Built from `PublicUser`, which already excludes `passwordHash` at the domain layer — this DTO can't accidentally leak it even by omission-mistake, since the field doesn't exist on its input type. */
export class UserResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() tenantId: string;
  @ApiProperty() email: string;
  @ApiProperty() role: string;
  @ApiProperty({ nullable: true }) lastLoginAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  private constructor(user: PublicUser) {
    this.id = user.id;
    this.tenantId = user.tenantId;
    this.email = user.email;
    this.role = user.role;
    this.lastLoginAt = user.lastLoginAt;
    this.createdAt = user.createdAt;
    this.updatedAt = user.updatedAt;
  }

  static fromDomain(user: PublicUser): UserResponseDto {
    return new UserResponseDto(user);
  }
}
