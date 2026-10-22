import { randomUUID } from "node:crypto";
import type { AiCompletionChunk } from "../src/modules/ai-provider/domain/ai-provider.port";
import {
  authHeader,
  bootVoiceRuntimeSimulator,
  parseTurnResult,
  type VoiceRuntimeSimulator,
} from "./voice-runtime-simulator";

/**
 * One whole call, end to end, over the real HTTP contract — and then an
 * audit of everything the model was actually handed on each of its turns.
 *
 * WHY THIS EXISTS, distinct from its neighbours: runtime-contract covers the
 * API lifecycle, conversation-quality covers history/interruption
 * bookkeeping, and the unit specs each cover one guard in isolation. None of
 * them answers the question that matters after a run of daily fixes — do all
 * these deterministic notes, gates and guards still agree with each other
 * when they meet on the same call?
 *
 * They are injected by eight or nine separate code paths now, every one of
 * them added in response to a real call, and each one phrased as an
 * instruction ("your whole reply is X", "ask nothing else", "never ask again
 * for anything listed here"). Two of those arriving together is not a
 * cosmetic problem: 2026-10-14's garbled replies were caused by exactly
 * that, and the model picking a different contradictory rule on different
 * calls is what a tester experiences as "it was good before".
 *
 * So the assertions below are deliberately about COHERENCE, not about the
 * model's wording, which a scripted fake cannot judge:
 *   - at most one directive note per turn, on every turn of a real call;
 *   - no two instructions in one message that cannot both be obeyed;
 *   - the call notes never state the same fact twice;
 *   - the injected material stays small enough not to drown the prompt;
 *   - and the call still completes: customer saved, lead saved, closed.
 */
describe("a whole call, and whether every injected instruction still agrees", () => {
  let sim: VoiceRuntimeSimulator;

  beforeEach(async () => {
    sim = await bootVoiceRuntimeSimulator();
  });

  afterEach(async () => {
    await sim.close();
  });

  const CUSTOMER_ID = "3f0c2b1e-9d5a-4c8e-8a57-0b1c2d3e4f50";

  async function startConversation() {
    const res = await sim.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: authHeader(sim.serviceToken),
      payload: {
        tenantId: randomUUID(),
        businessId: randomUUID(),
        callId: randomUUID(),
        callerAni: "+12065550147",
        timezone: "America/Los_Angeles",
      },
    });
    sim.aiProvider.reset();
    return res.json();
  }

  /** One scripted model reply: some words, optionally a tool call first. */
  function says(text: string): AiCompletionChunk[] {
    return [
      { type: "text_delta", text },
      { type: "done", stopReason: "end_turn" },
    ];
  }

  function callsTool(name: string, args: Record<string, unknown>): AiCompletionChunk[] {
    return [
      { type: "tool_call", toolCall: { id: randomUUID(), name, arguments: args } },
      { type: "done", stopReason: "tool_use" },
    ];
  }

  const ALL_TOOLS = [
    "searchCustomer",
    "escalateEmergency",
    "createCustomer",
    "createLead",
    "getServiceAreas",
  ];

  it("runs a realistic call to a saved lead, with every turn's instructions agreeing", async () => {
    sim.coreApiClient.postResponses.set("/internal/customers", { id: CUSTOMER_ID });
    sim.coreApiClient.postResponses.set("/internal/leads", { id: randomUUID() });
    sim.coreApiClient.postResponses.set("/internal/customers/resolve", {
      customerId: null,
      isReturning: false,
    });
    const conversation = await startConversation();

    // A real caller's side of a plumbing call, including every shape the
    // 2026-10-22 testers reported: a hard name spelled out, a house number,
    // a second problem, a question mid-intake, a request to repeat, and an
    // address correction.
    const call: Array<{ caller: string; model: AiCompletionChunk[] }> = [
      {
        caller: "hi, my kitchen sink is backing up pretty bad",
        model: says("Ah, sorry about that. Can I get your name?"),
      },
      {
        caller: "it's Siobhan Okonkwo",
        model: says("Could you spell that for me?"),
      },
      {
        caller: "s i o b h a n, o k o n k w o",
        model: says("Got it, Siobhan. What's the service address?"),
      },
      {
        caller: "4512 maple street",
        model: says("So that's 4512 Maple Street. And the ZIP?"),
      },
      {
        caller: "98032",
        model: says("Thanks. Is 206-555-0147 the best number to reach you?"),
      },
      {
        caller: "yeah that works, and the upstairs toilet keeps running too",
        model: says("Noted, the kitchen sink and the upstairs toilet. Anything else going on?"),
      },
      {
        caller: "no that's it, can someone come out today",
        model: says("The team confirms timing when they call. Is the sink still backing up now?"),
      },
      {
        caller: "what was that",
        model: says("The team confirms timing when they call."),
      },
      {
        caller: "actually it's 4512 maple street apartment b",
        model: says("Got it, apartment B. Let me get this to the team."),
      },
      {
        caller: "okay go ahead",
        model: callsTool("createCustomer", {
          name: { first: "Siobhan", last: "Okonkwo" },
          phone: "+12065550147",
          address: { street: "4512 Maple Street Apt B", city: "Kent", state: "WA", zip: "98032" },
          source: "ai_csr",
        }),
      },
      {
        caller: "that's everything, thanks",
        model: says("You're all set, Siobhan. The team will call you to set up a time."),
      },
    ];

    const sentPerTurn: string[] = [];

    for (const [index, step] of call.entries()) {
      // Each turn gets its own script: the reply above, then a generic
      // follow-up for any extra completion the tool loop needs.
      sim.aiProvider.responses = [
        step.model,
        callsTool("createLead", {
          customer_id: CUSTOMER_ID,
          problem_summary:
            "Kitchen sink backing up; upstairs toilet running. 4512 Maple Street Apt B, Kent 98032.",
          priority: "routine",
          lead_type: "residential",
        }),
        says("You're all set. The team will be in touch."),
      ];
      sim.aiProvider.reset();

      const res = await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: step.caller,
          sttConfidence: 0.93,
          allowedTools: ALL_TOOLS,
        },
      });
      expect(res.statusCode).toBe(200);
      const result = parseTurnResult(res);
      // Every turn says SOMETHING. A silent turn is the shape voice-runtime
      // turns into dead air and then "I'm having trouble".
      expect(String(result["responseText"]).trim().length).toBeGreaterThan(0);

      const lastRequest = sim.aiProvider.requests.at(-1);
      const userMessage = lastRequest?.messages.filter((m) => m.role === "user").at(-1)?.content;
      sentPerTurn.push(typeof userMessage === "string" ? userMessage : "");

      // Printed, not just asserted: the point of this test is that a human
      // can read what the model was handed on each turn of a real call and
      // see for themselves that it reads as one coherent instruction.
      // eslint-disable-next-line no-console
      console.log(`\n--- turn ${index + 1} | caller: "${step.caller}"\n${sentPerTurn.at(-1)}`);
    }

    // The call completed: the record and the request both exist.
    const paths = sim.coreApiClient.postCalls.map((postCall) => postCall.path);
    expect(paths).toContain("/internal/customers");
    expect(paths).toContain("/internal/leads");

    for (const [index, sent] of sentPerTurn.entries()) {
      const turn = `turn ${index + 1}`;

      // 1. At most ONE directive note. Two instructions each claiming to be
      //    "your whole reply" is the 2026-10-14 garbled-reply bug.
      const directiveMarkers = [
        "they are still talking",
        "read it back once",
        "ask for the ZIP",
        "ONLY question you ask is for their name",
        "Your reply asks only one question: whether",
        "service address is wrong",
        "did not hear you",
        "Your FIRST sentence answers it",
      ];
      const firing = directiveMarkers.filter((marker) => sent.includes(marker));
      expect(firing.length).toBeLessThanOrEqual(1);

      // 2. No pair of instructions that cannot both be obeyed.
      const contradictions: Array<[string, string]> = [
        ["Ask nothing else", "answer that in one short sentence first"],
        ["Say nothing and wait", "Your whole reply"],
        ["Say nothing and wait", "Your FIRST sentence answers it"],
        ["Do not spell it back", "spelled out by the caller"],
        // FOUND BY THIS TEST, 2026-10-22: the missing-lead reminder is
        // injected outside the one-directive-per-turn chain and prefixed
        // last, so on the address-read-back turn "Ask nothing else" was
        // followed by "your next question asks for it" as the final
        // instruction the model read.
        ["Ask nothing else", "your next question asks for it"],
        ["asks only one question", "your next question asks for it"],
        ["Say nothing and wait", "your next question asks for it"],
        ["did not hear you", "your next question asks for it"],
        ["Your FIRST sentence answers it", "your next question asks for it"],
      ];
      for (const [left, right] of contradictions) {
        expect(`${turn}: ${sent.includes(left) && sent.includes(right)}`).toBe(`${turn}: false`);
      }

      // 3. The call notes state each fact once. A duplicated fact is how a
      //    stale value survives next to its own correction.
      for (const fact of ["street address as heard", "ZIP:", "callback number they gave"]) {
        expect(sent.split(fact).length - 1).toBeLessThanOrEqual(1);
      }

      // 4. The word the client banned is never handed back as a word to
      //    use. FOUND BY THIS TEST: the call notes quoted the caller's own
      //    "today" into every later turn, while the prompt and the output
      //    guard both work to keep Grace from ever saying it.
      expect(`${turn}: ${/when they want help: "(today|tonight)"/i.test(sent)}`).toBe(
        `${turn}: false`,
      );

      // 5. The injected material stays a note, not a second prompt. The
      //    platform prompt is already long; these notes are read LAST and
      //    only work while they are short enough to read.
      expect(sent.length).toBeLessThan(2600);
    }
  }, 30_000);

  /**
   * The second tester's finding, end to end: "after the conversation reaches
   * the end and if the client asks for the information to be repeated the
   * csr starts taking extremely long pauses... sometimes the same line
   * arises that is im here speak up."
   *
   * Three separate fixes have to work TOGETHER for this to come out right —
   * the asking has to be recognised, the output guard's repeat suppression
   * has to stand down for it, and the turn must not come back empty. Any one
   * of them failing alone reproduces the finding, which is why this is
   * checked on a real call rather than three times in isolation.
   */
  it("repeats the details at the end of a call instead of going silent", async () => {
    sim.coreApiClient.postResponses.set("/internal/customers", { id: CUSTOMER_ID });
    sim.coreApiClient.postResponses.set("/internal/leads", { id: randomUUID() });
    const conversation = await startConversation();

    const setUp = [
      { caller: "my water heater is leaking", model: says("Sorry about that. Can I get your name?") },
      { caller: "it's Tom", model: says("Thanks Tom. What's the address?") },
      {
        caller: "1200 pine street, 98101",
        model: says("So that's 1-2-oh-oh Pine Street, 9-8-1-oh-1. Is that right?"),
      },
      { caller: "yes", model: says("Is 206-555-0147 the best number for you?") },
      { caller: "yes that's fine", model: says("You're all set. The team will call you.") },
    ];
    for (const step of setUp) {
      sim.aiProvider.responses = [step.model];
      sim.aiProvider.reset();
      await sim.inject({
        method: "POST",
        url: `/v1/conversations/${conversation.id}/turns`,
        headers: authHeader(sim.serviceToken),
        payload: {
          tenantId: conversation.tenantId,
          idempotencyKey: randomUUID(),
          transcript: step.caller,
          allowedTools: ALL_TOOLS,
        },
      });
    }

    // The caller asks for the details back — and the model answers with text
    // that REPEATS what it already said, which is exactly what was being
    // dropped as a repeated statement before.
    sim.aiProvider.responses = [
      says("Sure — Tom, 1-2-oh-oh Pine Street, 9-8-1-oh-1, and 206-555-0147."),
    ];
    sim.aiProvider.reset();
    const res = await sim.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/turns`,
      headers: authHeader(sim.serviceToken),
      payload: {
        tenantId: conversation.tenantId,
        idempotencyKey: randomUUID(),
        transcript: "can you repeat the information you have",
        allowedTools: ALL_TOOLS,
      },
    });

    const sent = sim.aiProvider.requests.at(-1)?.messages.filter((m) => m.role === "user").at(-1)
      ?.content;
    expect(String(sent)).toContain("did not hear you, or asked you to say it again");
    const spoken = String(parseTurnResult(res)["responseText"]);
    // Spoken, not dropped, and it is the details — not the fallback line.
    expect(spoken).toContain("Pine Street");
    expect(spoken).not.toContain("Sorry about the pause there");
  }, 30_000);

  /**
   * An emergency, which is the one path where the save gates must get OUT of
   * the way: speed beats a complete record. Checks that the whole chain
   * still agrees about that — the gates, the backstop and the transfer
   * signal the runtime acts on.
   */
  it("gets an emergency to the team without a gate blocking it", async () => {
    sim.coreApiClient.postResponses.set("/internal/customers", { id: CUSTOMER_ID });
    sim.coreApiClient.postResponses.set("/internal/leads", { id: randomUUID() });
    sim.coreApiClient.postResponses.set("/internal/emergency-rules/escalate", {
      isEmergency: true,
      severity: "critical",
      action: "forward_call",
      transferDestination: "+12065559999",
    });
    const conversation = await startConversation();

    sim.aiProvider.responses = [
      callsTool("escalateEmergency", {
        description: "burst pipe, water everywhere in the basement",
      }),
      says("That sounds urgent — shut off the main water valve if you can. Connecting you now."),
    ];
    sim.aiProvider.reset();

    const res = await sim.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/turns`,
      headers: authHeader(sim.serviceToken),
      payload: {
        tenantId: conversation.tenantId,
        idempotencyKey: randomUUID(),
        transcript: "a pipe burst, there's water everywhere in my basement",
        allowedTools: ALL_TOOLS,
      },
    });

    const result = parseTurnResult(res);
    expect(result["escalation"]).toMatchObject({ action: "forward_call" });
    expect(String(result["responseText"]).length).toBeGreaterThan(0);
    // The caller hears the safety line before anything hands the call off.
    expect(String(result["responseText"])).toContain("valve");
  }, 30_000);
});
