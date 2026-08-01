import { ApiProperty } from "@nestjs/swagger";
import { IsUUID, Matches } from "class-validator";
import { E164_PATTERN } from "../../../../shared/domain/e164";

/**
 * Tool-broker-facing variant of ResolveCustomerDto (docs/04 §3.1
 * `searchCustomer`) — same tenant-derivation rule as every other
 * controller in this codebase: `tenantId` comes from the authenticated
 * principal (here, a per-tenant API key provisioned for the
 * voice-orchestrator service), never a client-supplied field, so a caller
 * can never pass another tenant's id. `businessId` stays explicit because
 * an API key is tenant-scoped, not business-scoped, matching
 * ListCustomersQueryDto's identical precedent.
 */
export class ResolveCustomerToolDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty({ example: "+15551234567" })
  @Matches(E164_PATTERN, { message: "phoneE164 must be a valid E.164 phone number" })
  phoneE164!: string;
}
