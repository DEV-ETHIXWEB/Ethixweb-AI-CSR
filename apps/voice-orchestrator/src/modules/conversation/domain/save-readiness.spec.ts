import { saveBlockedReason, shouldNudgeForCallbackNumber } from "./save-readiness";

const asked = "Is the number you're calling from the best number to reach you?";
const base = {
  callerTexts: [] as string[],
  agentTexts: [asked] as string[],
  address: undefined,
  phone: "+12065550147",
};

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
          asked,
        ],
      }),
    ).toBeNull();
    expect(
      saveBlockedReason({
        ...base,
        callerTexts: ["clogged sink"],
        agentTexts: ["What's your address?", asked],
      })?.error,
    ).toBe("address_needed");
  });

  describe("callback number (client feedback: number never confirmed, a changed number ignored)", () => {
    const withAddress = {
      ...base,
      callerTexts: ["it's 1200 Pine Street, Seattle"],
      address: { street: "1200 Pine Street" },
    };

    it("blocks a save when the callback number was never asked about", () => {
      const result = saveBlockedReason({ ...withAddress, agentTexts: ["What's your address?"] });
      expect(result?.error).toBe("callback_number_not_confirmed");
    });

    it("allows the save once the number was asked about", () => {
      expect(saveBlockedReason(withAddress)).toBeNull();
    });

    it("forces the number the caller actually said, spoken digits included, over caller ID", () => {
      const result = saveBlockedReason({
        ...withAddress,
        callerTexts: [
          "it's 1200 Pine Street",
          "call me on two zero six five five five zero one eight four",
        ],
        phone: "+15554273090", // the caller ID the model wrongly preferred
      });
      expect(result?.error).toBe("phone_differs_from_what_caller_said");
      expect(result?.detail).toContain("206-555-0184");
    });

    it("accepts the save when the phone passed matches the number the caller said", () => {
      expect(
        saveBlockedReason({
          ...withAddress,
          agentTexts: ["What's your address?"],
          callerTexts: ["it's 1200 Pine Street", "my number is (206) 555-0184"],
          phone: "+12065550184",
        }),
      ).toBeNull();
    });

    it("does not hold up a real emergency for the confirmation, but still uses a number the caller gave", () => {
      expect(
        saveBlockedReason({
          ...base,
          agentTexts: [],
          callerTexts: ["a pipe burst and water is everywhere"],
        }),
      ).toBeNull();
      expect(
        saveBlockedReason({
          ...base,
          callerTexts: ["a pipe burst", "call me on 206 555 0184"],
          phone: "+12065550147",
        })?.error,
      ).toBe("phone_differs_from_what_caller_said");
    });
  });
});

describe("shouldNudgeForCallbackNumber (client feedback: ask the callback number, alone, once)", () => {
  const base2 = {
    callerTexts: ["my toilet runs", "it's 1200 Pine Street, Seattle"],
    agentTexts: ["What's your address?"],
  };

  it("nudges once the address is in and the number was never asked about", () => {
    expect(shouldNudgeForCallbackNumber(base2)).toBe(true);
  });

  it("does not nudge before an address, after the number was asked, when the caller gave a number, once saved, or in an emergency", () => {
    expect(shouldNudgeForCallbackNumber({ ...base2, callerTexts: ["my toilet runs"] })).toBe(false);
    expect(
      shouldNudgeForCallbackNumber({
        ...base2,
        agentTexts: [...base2.agentTexts, "Is this the best number to reach you?"],
      }),
    ).toBe(false);
    expect(
      shouldNudgeForCallbackNumber({
        ...base2,
        callerTexts: [...base2.callerTexts, "call me on 206 555 0147"],
      }),
    ).toBe(false);
    expect(shouldNudgeForCallbackNumber({ ...base2, customerId: "c1" })).toBe(false);
    expect(
      shouldNudgeForCallbackNumber({
        ...base2,
        callerTexts: ["a pipe burst", "it's 1200 Pine Street"],
      }),
    ).toBe(false);
  });
});
