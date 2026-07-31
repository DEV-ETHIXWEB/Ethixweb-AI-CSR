import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import type { LeadStatus } from "@ethixweb/database";

/** Mirrors lead-lifecycle.ts's ALLOWED_TRANSITIONS key set — the full LeadStatus enum, not invented here. `assertValidLeadStatusTransition` (domain/lead-lifecycle.ts) is the actual source of truth for which of these are reachable from the lead's current status; this DTO only validates the value is a real status at all. */
const LEAD_STATUSES = [
  "new",
  "notified",
  "claimed",
  "converted_to_job",
  "expired",
  "duplicate",
  "abandoned",
] as const;

export class TransitionLeadStatusDto {
  @ApiProperty({ enum: LEAD_STATUSES })
  @IsIn(LEAD_STATUSES)
  toStatus!: LeadStatus;
}
