import { Injectable } from "@nestjs/common";
import { RedisService } from "../../../shared/redis/redis.service";
import type { Conversation } from "../domain/conversation.entity";
import { ConversationAlreadyExistsError } from "../domain/errors";
import type { ConversationRepository } from "../domain/ports/conversation-repository.port";

/**
 * Conversation state is CALL-SCOPED, ephemeral, and read/written several
 * times per second on the latency-critical path (docs/02 §3's sub-1000ms
 * budget) — Redis, not Postgres. This is not a shortcut around durability:
 * docs/01 §9's deployment diagram gives the voice-orchestrator service an
 * edge to ElastiCache and none to RDS, which is exactly this design. The
 * durable record of what happened on a call (`Transcript`, `ToolCall`,
 * `VoiceSession` Prisma rows) belongs to the future `calls` module
 * (docs/13, Phase 10) — those tables foreign-key to `calls.id`, and no
 * module creates a `Call` row yet, so persisting them here is impossible
 * today, not merely deferred by preference.
 *
 * TTL is generous (4h) relative to any real call length so a
 * mid-call crash/restart can resume from state rather than dropping the
 * caller — docs/13's `calls` module §3 names "mid-call crash recovery" as
 * an explicit requirement.
 */
const CONVERSATION_TTL_SECONDS = 4 * 60 * 60;

/**
 * Atomic compare-and-swap for `save()`. A plain `HGET` + JS-side version
 * check + `HSET` would itself be a read-then-write race (the exact bug this
 * exists to close) — the whole check-and-write must happen in one round
 * trip. Deliberately a plain `HGET`/`HSET`-based check rather than storing
 * the whole conversation as one JSON string and comparing via `cjson.decode`
 * in Lua: `cjson` is a real Redis built-in in production, but the
 * `ioredis-mock` double this whole suite's unit tests run against (this
 * module has no real Redis available in this environment — same documented
 * boundary as every other Redis-backed piece of this codebase) uses a
 * standalone Lua VM (fengari) with no `cjson` global, so a `cjson`-based
 * script cannot be verified live at all here. `HGET`/`HSET` are ordinary
 * commands both the real server and the mock implement identically, so this
 * version is actually verifiable, not just "should work in production."
 * Returns 1 on a successful write, 0 if the stored version didn't match
 * (conflict) or the key is gone (expired/never existed).
 */
const CAS_SAVE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'version')
if current == false then
  return 0
end
if current ~= ARGV[1] then
  return 0
end
redis.call('HSET', KEYS[1], 'version', ARGV[2], 'data', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
`;

@Injectable()
export class RedisConversationRepository implements ConversationRepository {
  constructor(private readonly redis: RedisService) {}

  async create(conversation: Conversation): Promise<Conversation> {
    // `SET NX` on the call-id index makes "one conversation per call"
    // atomic against two concurrent starts for the same call, rather than
    // a check-then-write race — the same discipline CreateLeadUseCase
    // relies on `UNIQUE(call_id)` for in Postgres. No CAS needed on the
    // conversation blob itself: this is the first write for this id, and
    // the NX index reservation above already makes it impossible for two
    // concurrent creates to both reach here for the same callId.
    const reserved = await this.redis.set(
      this.callIndexKey(conversation.tenantId, conversation.callId),
      conversation.id,
      "EX",
      CONVERSATION_TTL_SECONDS,
      "NX",
    );
    if (reserved !== "OK") {
      throw new ConversationAlreadyExistsError(conversation.callId);
    }
    await this.write(conversation);
    return conversation;
  }

  async findById(tenantId: string, conversationId: string): Promise<Conversation | null> {
    const raw = await this.redis.hget(this.key(tenantId, conversationId), "data");
    return raw ? (JSON.parse(raw) as Conversation) : null;
  }

  async findByCallId(tenantId: string, callId: string): Promise<Conversation | null> {
    const conversationId = await this.redis.get(this.callIndexKey(tenantId, callId));
    return conversationId ? this.findById(tenantId, conversationId) : null;
  }

  async save(conversation: Conversation): Promise<Conversation | null> {
    const next: Conversation = { ...conversation, version: conversation.version + 1 };
    const result = await this.redis.eval(
      CAS_SAVE_SCRIPT,
      1,
      this.key(conversation.tenantId, conversation.id),
      String(conversation.version),
      String(next.version),
      JSON.stringify(next),
      String(CONVERSATION_TTL_SECONDS),
    );
    return result === 1 ? next : null;
  }

  private async write(conversation: Conversation): Promise<void> {
    const key = this.key(conversation.tenantId, conversation.id);
    await this.redis.hset(
      key,
      "version",
      String(conversation.version),
      "data",
      JSON.stringify(conversation),
    );
    await this.redis.expire(key, CONVERSATION_TTL_SECONDS);
  }

  private key(tenantId: string, conversationId: string): string {
    return `conversation:${tenantId}:${conversationId}`;
  }

  private callIndexKey(tenantId: string, callId: string): string {
    return `conversation-by-call:${tenantId}:${callId}`;
  }
}
