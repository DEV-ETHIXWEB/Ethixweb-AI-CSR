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

@Injectable()
export class RedisConversationRepository implements ConversationRepository {
  constructor(private readonly redis: RedisService) {}

  async create(conversation: Conversation): Promise<Conversation> {
    // `SET NX` on the call-id index makes "one conversation per call"
    // atomic against two concurrent starts for the same call, rather than
    // a check-then-write race — the same discipline CreateLeadUseCase
    // relies on `UNIQUE(call_id)` for in Postgres.
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
    const raw = await this.redis.get(this.key(tenantId, conversationId));
    return raw ? (JSON.parse(raw) as Conversation) : null;
  }

  async findByCallId(tenantId: string, callId: string): Promise<Conversation | null> {
    const conversationId = await this.redis.get(this.callIndexKey(tenantId, callId));
    return conversationId ? this.findById(tenantId, conversationId) : null;
  }

  async save(conversation: Conversation): Promise<Conversation> {
    await this.write(conversation);
    return conversation;
  }

  private async write(conversation: Conversation): Promise<void> {
    await this.redis.set(
      this.key(conversation.tenantId, conversation.id),
      JSON.stringify(conversation),
      "EX",
      CONVERSATION_TTL_SECONDS,
    );
  }

  private key(tenantId: string, conversationId: string): string {
    return `conversation:${tenantId}:${conversationId}`;
  }

  private callIndexKey(tenantId: string, callId: string): string {
    return `conversation-by-call:${tenantId}:${callId}`;
  }
}
