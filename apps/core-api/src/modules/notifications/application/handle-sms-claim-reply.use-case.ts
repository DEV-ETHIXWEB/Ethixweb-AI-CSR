import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { ClaimLeadUseCase } from "../../leads/application/claim-lead.use-case";
import { LeadAlreadyClaimedError } from "../../leads/domain/errors";
import { RedisClaimMappingStore } from "../infrastructure/redis-claim-mapping.store";

export type SmsClaimReplyOutcome =
  | { status: "claimed"; leadId: string }
  | { status: "already_claimed"; leadId: string }
  | { status: "no_mapping" }
  | { status: "ignored" };

const CLAIM_KEYWORD = "CLAIM";

/**
 * docs/07 §4's claim mechanism: "Reply CLAIM" resolved via the short-lived
 * phone->lead mapping (RedisClaimMappingStore), then delegated entirely to
 * the EXISTING, already-race-safe ClaimLeadUseCase (Phase 5) — this
 * use-case does not reimplement the atomic compare-and-set claim; docs/07
 * §4's sequence diagram and Phase 5's ClaimLeadUseCase describe the exact
 * same `UPDATE leads SET status='claimed' WHERE status='notified'` +
 * `INSERT lead_claims` operation.
 */
@Injectable()
export class HandleSmsClaimReplyUseCase {
  constructor(
    private readonly claimMappingStore: RedisClaimMappingStore,
    private readonly claimLeadUseCase: ClaimLeadUseCase,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(fromPhone: string, messageBody: string): Promise<SmsClaimReplyOutcome> {
    if (messageBody.trim().toUpperCase() !== CLAIM_KEYWORD) {
      return { status: "ignored" };
    }

    const mapping = await this.claimMappingStore.resolve(fromPhone);
    if (!mapping) {
      this.logger.warn(
        "CLAIM reply received with no matching phone->lead mapping (expired or never sent)",
        {
          fromPhone,
        },
      );
      return { status: "no_mapping" };
    }

    try {
      await this.claimLeadUseCase.execute({
        tenantId: mapping.tenantId,
        leadId: mapping.leadId,
        claimedByUserId: mapping.userId,
        claimMethod: "sms_reply",
      });
      return { status: "claimed", leadId: mapping.leadId };
    } catch (error) {
      if (error instanceof LeadAlreadyClaimedError) {
        return { status: "already_claimed", leadId: mapping.leadId };
      }
      throw error;
    }
  }
}
