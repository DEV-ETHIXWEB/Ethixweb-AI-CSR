import { Injectable } from "@nestjs/common";
import { Prisma } from "@ethixweb/database";
import { LeadAlreadyClaimedError } from "../domain/errors";
import type { LeadClaim } from "../domain/lead-claim.entity";
import type {
  CreateLeadClaimInput,
  Db,
  LeadClaimRepository,
} from "../domain/ports/lead-claim-repository.port";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

@Injectable()
export class PrismaLeadClaimRepository implements LeadClaimRepository {
  async create(db: Db, input: CreateLeadClaimInput): Promise<LeadClaim> {
    try {
      return await db.leadClaim.create({
        data: {
          tenantId: input.tenantId,
          leadId: input.leadId,
          claimedByUserId: input.claimedByUserId,
          claimMethod: input.claimMethod,
        },
      });
    } catch (error) {
      // Unlike the customers/leads CREATE races (where the documented
      // behavior is "return the existing row, never an error"), claiming a
      // lead is meant to be exclusive — the first dispatcher to hit
      // `UNIQUE(lead_id)` wins, every other concurrent claim gets a real
      // conflict, not a silently-shared success.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new LeadAlreadyClaimedError(input.leadId);
      }
      throw error;
    }
  }

  async findByLeadId(db: Db, tenantId: string, leadId: string): Promise<LeadClaim | null> {
    return db.leadClaim.findFirst({ where: { leadId, tenantId } });
  }
}
