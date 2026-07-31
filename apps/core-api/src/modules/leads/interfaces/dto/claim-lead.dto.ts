import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

/** docs/06-database-schema.md LEAD_CLAIMS.claim_method — how the dispatcher took ownership. Not a documented closed enum, but a bounded set matching the dispatcher inbox UI's own action surface (no free-text claim_method has ever been specified anywhere in docs/04-13), so validated as one here rather than left as unconstrained input. */
const CLAIM_METHODS = ["manual", "auto_assign"] as const;

export class ClaimLeadDto {
  @ApiProperty({ enum: CLAIM_METHODS })
  @IsIn(CLAIM_METHODS)
  claimMethod!: (typeof CLAIM_METHODS)[number];
}
