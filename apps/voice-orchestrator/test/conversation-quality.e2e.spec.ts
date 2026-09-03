import { randomUUID } from "node:crypto";
import {
  authHeader,
  bootVoiceRuntimeSimulator,
  type VoiceRuntimeSimulator,
} from "./voice-runtime-simulator";

/**
 * Conversation-quality regression suite — the voice-experience
 * optimization pass's Step 10. Distinct from runtime-contract.e2e.spec.ts
 * (API/lifecycle correctness) and context-window.spec.ts (the
 * compression ALGORITHM's own unit tests, not duplicated here): this
 * file covers the mechanically-verifiable half of "does the conversation
 * feel like one continuous exchange, not disconnected turns" —
 * specifically, whether the ORCHESTRATION layer (message history,
 * interruption bookkeeping, tool-call counts) stays correct across
 * turns. `FakeAiProvider` scripts a canned model, so it cannot prove the
 * MODEL's own output is natural, concise, or contextually apt (that
 * needs a real LLM — see the live scenario runner this same pass adds)
 * — what it CAN prove, deterministically and in CI, is that the
 * plumbing feeding the model never loses, duplicates, or corrupts
 * context across a multi-turn, interrupted, or emergency-laden call.
 */
describe("Conversation quality — orchestration-layer correctness across turns", () => {
  let sim: VoiceRuntimeSimulator;

  beforeEach(async () => {
    sim = await bootVoiceRuntimeSimulator();
  });

  afterEach(async () => {
    await sim.close();
  });

  function startPayload(overrides: Record<string, unknown> = {}) {
    return {
      tenantId: randomUUID(),
      businessId: randomUUID(),
      callId: randomUUID(),
      callerAni: "+15551234567",
      timezone: "America/Chicago",
      ...overrides,
    };
  }

  async function startConversation() {
    const res = await sim.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: authHeader(sim.serviceToken),
      payload: startPayload(),
    });
    sim.aiProvider.reset();
    return res.json();
  }

  function scriptText(text: string) {
    sim.aiProvider.responses = [
      [
        { type: "text_delta", text },
        { type: "done", stopReason: "end_turn" },
      ],
    ];
  }

  async function turn(conversationId: string, tenantId: string, transcript: string) {
    return sim.inject({
      method: "POST",
      url: `/v1/conversations/${conversationId}/turns`,
      headers: authHeader(sim.serviceToken),
      payload: {
        tenantId,
        idempotencyKey: randomUUID(),
        transcript,
        allowedTools: ["searchCustomer", "createCustomer", "createLead", "escalateEmergency"],
      },
    });
  }

  /**
   * Scenario E (interruption) + the barge-in correctness fix's own
   * full-stack proof, not just interrupt-conversation.use-case.spec.ts's
   * unit-level one: does the annotation actually reach the NEXT real LLM
   * request, all the way through the real HTTP contract?
   */
  describe("Scenario E: interruption mid-playback", () => {
    it("the NEXT turn's LLM request includes the interrupted-response annotation, proving it survived the full round-trip", async () => {
      const conversation = await startConversation();
      scriptText("I'm sorry to hear that. Is it blowing warm air, or barely any air at all?");
      await turn(conversation.id, conversation.tenantId, "My AC stopped cooling yesterday");

      await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/interrupt`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId },
      });

      scriptText("Got it, let me get your address.");
      sim.aiProvider.requests.length = 0; // isolate just this next request's messages
      await turn(conversation.id, conversation.tenantId, "It's blowing warm air");

      const sentMessages = sim.aiProvider.requests[0]?.messages ?? [];
      const interruptedAssistantMessage = sentMessages.find(
        (message) =>
          message.role === "assistant" && message.content.includes("the caller interrupted"),
      );
      expect(interruptedAssistantMessage).toBeDefined();
      expect(interruptedAssistantMessage?.content).toContain("Is it blowing warm air");
    });
  });

  /**
   * Scenario F (double interruption): CSR -> customer -> CSR -> customer.
   * Must not crash, corrupt state, or stack duplicate annotations.
   */
  describe("Scenario F: double interruption", () => {
    it("survives two consecutive interruptions without crashing or leaving the conversation in an invalid state", async () => {
      const conversation = await startConversation();
      scriptText("First response before being cut off.");
      await turn(conversation.id, conversation.tenantId, "First thing I said");

      const first = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/interrupt`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId },
      });
      expect(first.statusCode).toBe(200);

      scriptText("Second response before ALSO being cut off.");
      await turn(conversation.id, conversation.tenantId, "Second thing I said");

      const second = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/interrupt`,
        headers: authHeader(sim.serviceToken),
        payload: { tenantId: conversation.tenantId },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().state).toBe("silence");

      // BOTH responses were genuinely interrupted (this scenario
      // interrupts after every turn), so both correctly carry the
      // annotation — the requirement is that each interrupted message
      // gets annotated once, not stacked, not lost, not conflated with
      // the other one.
      scriptText("Third response.");
      sim.aiProvider.requests.length = 0;
      await turn(conversation.id, conversation.tenantId, "Third thing I said");
      const sentMessages = sim.aiProvider.requests[0]?.messages ?? [];
      const annotated = sentMessages.filter(
        (message) =>
          message.role === "assistant" && message.content.includes("the caller interrupted"),
      );
      expect(annotated).toHaveLength(2);
      expect(annotated[0]?.content).toContain("First response");
      expect(annotated[1]?.content).toContain("Second response");
      // Neither annotation is stacked/duplicated on itself.
      for (const message of annotated) {
        expect(message.content.split("the caller interrupted")).toHaveLength(2);
      }
    });
  });

  /**
   * Scenario D (correction): "no wait, I meant Tuesday" as its own turn.
   * The orchestration layer's job is simply to never drop either the
   * original statement or the correction from what the model sees next
   * — whether the MODEL correctly reconciles them is a real-LLM concern
   * this fake can't verify, but losing either message from history would
   * make correct reconciliation impossible regardless of model quality.
   */
  describe("Scenario D: correction preserves both the original statement and the correction", () => {
    it("both turns remain in the message history sent to the model on a later turn", async () => {
      const conversation = await startConversation();
      scriptText("Got it, what's the best day for a callback?");
      await turn(conversation.id, conversation.tenantId, "Monday works for me");

      scriptText("Got it, Tuesday instead.");
      await turn(conversation.id, conversation.tenantId, "No wait, sorry, I meant Tuesday");

      scriptText("Understood, anything else?");
      sim.aiProvider.requests.length = 0;
      await turn(conversation.id, conversation.tenantId, "That's everything");

      const sentMessages = sim.aiProvider.requests[0]?.messages ?? [];
      const userTexts = sentMessages
        .filter((message) => message.role === "user")
        .map((message) => message.content);
      expect(userTexts).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Monday works for me"),
          expect.stringContaining("No wait, sorry, I meant Tuesday"),
        ]),
      );
    });
  });

  /**
   * Scenario M (emergency remains immediate): the single hard requirement
   * this whole optimization pass must never trade away. Proves the
   * escalateEmergency backstop (HandleTurnUseCase) fires on the FIRST
   * substantive turn with no unnecessary extra LLM round trips — the
   * baseline "immediate" case with zero confounding turns beforehand.
   * (The interrupt-annotation fix and this backstop are architecturally
   * independent — different endpoints, different use cases, no shared
   * state beyond conversation.messages itself — so there is no
   * plausible mechanism by which one could gate or slow the other; the
   * regression that actually matters is THIS one staying fast and
   * correct on its own.)
   */
  describe("Scenario M: emergency detection remains immediate", () => {
    it("escalateEmergency fires on the caller's very first utterance, with no unnecessary extra LLM round trips", async () => {
      const conversation = await startConversation();
      // Model does NOT call escalateEmergency itself — the backstop
      // (HandleTurnUseCase) must still force the real check on turn 1.
      scriptText("Let's get you help right away.");

      const res = await turn(
        conversation.id,
        conversation.tenantId,
        "There's a pipe burst and water is flooding my basement!",
      );

      expect(res.statusCode).toBe(200);
      expect(res.json().toolCallsExecuted).toContain("escalateEmergency");
      // Exactly 2 LLM completions for this turn: the model's own first
      // response (which skips the tool), then one more so the model can
      // react to the backstop's forced escalateEmergency result — not a
      // wasteful third or fourth round trip.
      expect(sim.aiProvider.requests).toHaveLength(2);
    });
  });
});
