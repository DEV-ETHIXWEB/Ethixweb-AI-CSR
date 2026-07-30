import { ApiProperty } from "@nestjs/swagger";
import type { TenantStatus } from "@ethixweb/database";
import { IsIn } from "class-validator";

/** Mirrors the TenantStatus enum — see docs/15-tenant-lifecycle-billing-and-analytics.md §2. */
export const TENANT_STATUSES = [
  "trial",
  "active",
  "past_due",
  "suspended",
  "offboarding",
  "archived",
  "expired",
] as const satisfies readonly TenantStatus[];

export class TransitionTenantStatusDto {
  @ApiProperty({ enum: TENANT_STATUSES })
  @IsIn(TENANT_STATUSES)
  status!: TenantStatus;
}
