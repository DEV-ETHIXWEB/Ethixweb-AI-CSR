import { Injectable } from "@nestjs/common";
import { RedisService } from "../../../shared/redis/redis.service";

export interface ClaimMapping {
  tenantId: string;
  leadId: string;
  userId: string;
}

const KEY_PREFIX = "sms-claim:";
const DEFAULT_TTL_SECONDS = 60 * 60;

/**
 * docs/07 §4: "Claim replies are matched to a lead via a short-lived
 * mapping (phone_number → most-recent-open-lead-notified-to-that-number,
 * TTL'd) so 'CLAIM' alone is unambiguous." Written at SEND time (see
 * SendLeadNotificationUseCase) — the phone number is the TECHNICIAN's own
 * number (whoever we texted), and the mapping already carries `userId`
 * because it was known at send time (the channel's configured `userId` —
 * see NotificationDestination's own comment on why that's necessary:
 * `User` has no phone column, so this is the only place a phone number and
 * a user identity are ever linked in this build).
 */
@Injectable()
export class RedisClaimMappingStore {
  constructor(private readonly redis: RedisService) {}

  async remember(
    phone: string,
    mapping: ClaimMapping,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    await this.redis.set(`${KEY_PREFIX}${phone}`, JSON.stringify(mapping), "EX", ttlSeconds);
  }

  async resolve(phone: string): Promise<ClaimMapping | null> {
    const raw = await this.redis.get(`${KEY_PREFIX}${phone}`);
    return raw ? (JSON.parse(raw) as ClaimMapping) : null;
  }
}
