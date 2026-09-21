import { saveBlockedReason } from "./save-readiness";

const base = { callerTexts: [] as string[], agentTexts: [] as string[], address: undefined };

describe("saveBlockedReason (client feedback: no submitting before name and address)", () => {
  it("blocks a routine call that has no street address yet", () => {
    const result = saveBlockedReason({
      ...base,
      callerTexts: ["my name is Tom and my sink is clogged"],
    });
    expect(result?.error).toBe("address_needed");
  });

  it("blocks when the caller gave a street but the save omitted it, so it is never lost", () => {
    const result = saveBlockedReason({
      ...base,
      callerTexts: ["it's 1200 Pine Street, Seattle"],
    });
    expect(result?.error).toBe("address_not_passed");
  });

  it("allows the save once the street is given and passed in", () => {
    expect(
      saveBlockedReason({
        ...base,
        callerTexts: ["it's 1200 Pine Street, Seattle"],
        address: { street: "1200 Pine Street" },
      }),
    ).toBeNull();
  });

  it("never holds up a real emergency", () => {
    expect(
      saveBlockedReason({ ...base, callerTexts: ["a pipe burst and water is everywhere"] }),
    ).toBeNull();
    expect(
      saveBlockedReason({ ...base, callerTexts: ["it kinda smells like gas in here"] }),
    ).toBeNull();
  });

  it("does not treat an ordinary drip as an emergency", () => {
    expect(
      saveBlockedReason({ ...base, callerTexts: ["my faucet is leaking a little"] })?.error,
    ).toBe("address_needed");
  });

  it("lets a caller who declines to give an address through", () => {
    expect(
      saveBlockedReason({
        ...base,
        callerTexts: ["I'd rather not give my address over the phone"],
      }),
    ).toBeNull();
  });

  it("lets the call through after the address was asked for three times", () => {
    expect(
      saveBlockedReason({
        ...base,
        callerTexts: ["clogged sink", "just send someone"],
        agentTexts: [
          "What's your address?",
          "Sorry, what's the street address?",
          "And the address?",
        ],
      }),
    ).toBeNull();
    expect(
      saveBlockedReason({
        ...base,
        callerTexts: ["clogged sink"],
        agentTexts: ["What's your address?"],
      })?.error,
    ).toBe("address_needed");
  });
});
