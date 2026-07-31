import { randomUUID } from "node:crypto";
import { LeadAlreadyClaimedError } from "../../domain/errors";
import type { LeadClaim } from "../../domain/lead-claim.entity";
import type {
  CreateLeadClaimInput,
  Db,
  LeadClaimRepository,
} from "../../domain/ports/lead-claim-repository.port";

export class FakeLeadClaimRepository implements LeadClaimRepository {
  private readonly claims = new Map<string, LeadClaim>();

  // Synchronous body — same exclusivity guarantee as the real
  // `UNIQUE(lead_id)` constraint PrismaLeadClaimRepository.create enforces,
  // exercised concurrently in ClaimLeadUseCase's own race test.
  async create(_db: Db, input: CreateLeadClaimInput): Promise<LeadClaim> {
    for (const existing of this.claims.values()) {
      if (existing.tenantId === input.tenantId && existing.leadId === input.leadId) {
        throw new LeadAlreadyClaimedError(input.leadId);
      }
    }
    const claim: LeadClaim = {
      id: randomUUID(),
      tenantId: input.tenantId,
      leadId: input.leadId,
      claimedByUserId: input.claimedByUserId,
      claimMethod: input.claimMethod,
      claimedAt: new Date(),
    };
    this.claims.set(claim.id, claim);
    return claim;
  }

  async findByLeadId(_db: Db, tenantId: string, leadId: string): Promise<LeadClaim | null> {
    for (const claim of this.claims.values()) {
      if (claim.tenantId === tenantId && claim.leadId === leadId) {
        return claim;
      }
    }
    return null;
  }
}
