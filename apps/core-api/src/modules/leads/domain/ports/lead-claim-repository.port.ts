import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { LeadClaim } from "../lead-claim.entity";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateLeadClaimInput {
  tenantId: string;
  leadId: string;
  claimedByUserId: string;
  claimMethod: string;
}

export interface LeadClaimRepository {
  /** Throws on a `UNIQUE(lead_id)` violation — ClaimLeadUseCase catches this and maps it to LeadAlreadyClaimedError (unlike the create-lead race, claiming IS meant to be exclusive: only the first dispatcher wins). */
  create(db: Db, input: CreateLeadClaimInput): Promise<LeadClaim>;
  findByLeadId(db: Db, tenantId: string, leadId: string): Promise<LeadClaim | null>;
}

export const LEAD_CLAIM_REPOSITORY = Symbol("LEAD_CLAIM_REPOSITORY");
