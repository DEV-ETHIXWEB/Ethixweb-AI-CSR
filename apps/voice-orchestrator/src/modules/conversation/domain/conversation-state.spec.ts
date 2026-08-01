import {
  assertValidConversationTransition,
  CONVERSATION_STATES,
  IllegalConversationTransitionError,
  isTerminalState,
  type ConversationState,
} from "./conversation-state";

const VALID: Array<[ConversationState, ConversationState]> = [
  ["greeting", "identifying"],
  ["greeting", "silence"],
  ["identifying", "qualifying"],
  ["qualifying", "emergency_check"],
  ["emergency_check", "emergency_transfer"],
  ["emergency_check", "qualifying"],
  ["qualifying", "confirming"],
  ["confirming", "closing"],
  ["confirming", "qualifying"],
  ["closing", "ended"],
  ["qualifying", "human_requested"],
  ["qualifying", "voicemail"],
  ["silence", "qualifying"],
  ["silence", "voicemail"],
];

describe("assertValidConversationTransition", () => {
  it.each(VALID)("allows %s -> %s (docs/03 §2)", (from, to) => {
    expect(() => assertValidConversationTransition(from, to)).not.toThrow();
  });

  it.each(CONVERSATION_STATES)(
    "treats a same-state transition (%s) as an idempotent no-op",
    (state) => {
      expect(() => assertValidConversationTransition(state, state)).not.toThrow();
    },
  );

  it("rejects skipping greeting straight to closing", () => {
    expect(() => assertValidConversationTransition("greeting", "closing")).toThrow(
      IllegalConversationTransitionError,
    );
  });

  it("rejects any transition out of the terminal 'ended' state", () => {
    for (const to of CONVERSATION_STATES) {
      if (to === "ended") {
        continue;
      }
      expect(() => assertValidConversationTransition("ended", to)).toThrow(
        IllegalConversationTransitionError,
      );
    }
  });

  it("identifies 'ended' as the only terminal state", () => {
    const terminals = CONVERSATION_STATES.filter(isTerminalState);
    expect(terminals).toEqual(["ended"]);
  });
});
