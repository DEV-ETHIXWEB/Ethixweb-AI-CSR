import { InvalidKnowledgeLifecycleTransitionError } from "./errors";
import { assertValidKnowledgeStatusTransition } from "./knowledge-lifecycle";

describe("assertValidKnowledgeStatusTransition", () => {
  it("allows draft -> approved", () => {
    expect(() => assertValidKnowledgeStatusTransition("item-1", "draft", "approved")).not.toThrow();
  });

  it("allows draft -> disabled", () => {
    expect(() => assertValidKnowledgeStatusTransition("item-1", "draft", "disabled")).not.toThrow();
  });

  it("allows approved -> disabled", () => {
    expect(() =>
      assertValidKnowledgeStatusTransition("item-1", "approved", "disabled"),
    ).not.toThrow();
  });

  it("allows disabled -> draft", () => {
    expect(() => assertValidKnowledgeStatusTransition("item-1", "disabled", "draft")).not.toThrow();
  });

  it("rejects approved -> draft (must go through disabled first)", () => {
    expect(() => assertValidKnowledgeStatusTransition("item-1", "approved", "draft")).toThrow(
      InvalidKnowledgeLifecycleTransitionError,
    );
  });

  it("rejects every same-state pair (draft->draft, approved->approved, disabled->disabled)", () => {
    expect(() => assertValidKnowledgeStatusTransition("item-1", "draft", "draft")).toThrow(
      InvalidKnowledgeLifecycleTransitionError,
    );
    expect(() => assertValidKnowledgeStatusTransition("item-1", "approved", "approved")).toThrow(
      InvalidKnowledgeLifecycleTransitionError,
    );
    expect(() => assertValidKnowledgeStatusTransition("item-1", "disabled", "disabled")).toThrow(
      InvalidKnowledgeLifecycleTransitionError,
    );
  });

  it("rejects disabled -> approved", () => {
    expect(() => assertValidKnowledgeStatusTransition("item-1", "disabled", "approved")).toThrow(
      InvalidKnowledgeLifecycleTransitionError,
    );
  });
});
