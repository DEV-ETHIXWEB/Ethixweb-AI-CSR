import IoRedisMock from "ioredis-mock";
import type { RedisService } from "../../../shared/redis/redis.service";
import type { Conversation } from "../domain/conversation.entity";
import { ConversationAlreadyExistsError } from "../domain/errors";
import { RedisConversationRepository } from "./redis-conversation.repository";

function baseConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    tenantId: "tenant-1",
    businessId: "business-1",
    callId: "call-1",
    state: "greeting",
    systemPrompt: "sys",
    llmModel: "gpt-4o",
    messages: [],
    transcript: [],
    leadId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    capacityReservationId: "reservation-1",
    endReason: null,
    ...overrides,
  };
}

describe("RedisConversationRepository", () => {
  // ioredis-mock instances share one in-memory store by default (no real
  // network connection to isolate them the way separate real Redis
  // clients would be) — flushed between tests so each test starts clean.
  let redis: RedisService;
  let repository: RedisConversationRepository;

  beforeEach(async () => {
    redis = new IoRedisMock() as unknown as RedisService;
    await redis.flushall();
    repository = new RedisConversationRepository(redis);
  });

  it("creates and round-trips a conversation by id", async () => {
    const conversation = baseConversation();

    await repository.create(conversation);
    const found = await repository.findById("tenant-1", "conv-1");

    expect(found).toEqual(conversation);
  });

  it("looks up a conversation by callId via the secondary index", async () => {
    await repository.create(baseConversation());

    const found = await repository.findByCallId("tenant-1", "call-1");

    expect(found?.id).toBe("conv-1");
  });

  it("throws ConversationAlreadyExistsError on a second create for the same call_id (atomic NX reservation)", async () => {
    await repository.create(baseConversation());

    await expect(repository.create(baseConversation({ id: "conv-2" }))).rejects.toThrow(
      ConversationAlreadyExistsError,
    );
  });

  it("save() persists updates visible to a subsequent findById", async () => {
    const conversation = await repository.create(baseConversation());

    await repository.save({ ...conversation, state: "identifying" });

    const found = await repository.findById("tenant-1", "conv-1");
    expect(found?.state).toBe("identifying");
  });

  it("returns null for a conversation that doesn't exist", async () => {
    expect(await repository.findById("tenant-1", "missing")).toBeNull();
    expect(await repository.findByCallId("tenant-1", "missing-call")).toBeNull();
  });
});
