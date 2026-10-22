import {
  callbackNumberNote,
  leadProblemBlockedReason,
  saveBlockedReason,
  shouldNudgeForCallbackNumber,
} from "./save-readiness";

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

  it("blocks a save when the address was given but not read back to the caller", () => {
    expect(
      saveBlockedReason({
        ...base,
        callerTexts: ["it's 1200 Pine Street, Seattle"],
        address: { street: "1200 Pine Street" },
      })?.error,
    ).toBe("address_not_confirmed");
  });

  it("allows the save once the street is given, passed in, and read back", () => {
    expect(
      saveBlockedReason({
        ...base,
        callerTexts: ["it's 1200 Pine Street, Seattle"],
        agentTexts: [...base.agentTexts, "So that's 1200 Pine Street, Seattle?"],
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
      agentTexts: [...base.agentTexts, "So that's 1200 Pine Street?"],
      address: { street: "1200 Pine Street" },
    };

    it("blocks a save when the callback number was never asked about", () => {
      const result = saveBlockedReason({
        ...withAddress,
        agentTexts: ["What's your address?", "So that's 1200 Pine Street?"],
      });
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
          agentTexts: ["What's your address?", "So that's 1200 Pine Street?"],
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
    agentTexts: [
      "Can I get your name?",
      "What's your address?",
      "So that's 1200 Pine Street, Seattle?",
    ],
  };

  it("QA 2026-10-13: waits until the address has been read back", () => {
    expect(
      shouldNudgeForCallbackNumber({
        ...base2,
        agentTexts: ["Can I get your name?", "What's your address?"],
      }),
    ).toBe(false);
  });

  it("QA 2026-10-13: waits until the caller's name is known, so it never fires on a caller's opening line", () => {
    expect(
      shouldNudgeForCallbackNumber({
        callerTexts: ["my kitchen sink is leaking, I'm at 1201 South 56th Place, Seattle"],
        agentTexts: [],
      }),
    ).toBe(false);
  });

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

describe("client feedback (Prateek, 2026-10-09): an address given early in a long call still counts", () => {
  const early = ["my name is pratik", "the address is 42 Maple Street, Atlanta 30301"];
  const later = Array.from({ length: 14 }, (_, i) => `answer number ${i + 1}`);

  it("does not refuse the save as address_needed when the street came more than 12 replies ago", () => {
    const result = saveBlockedReason({
      ...base,
      callerTexts: [...early, ...later],
      agentTexts: [...base.agentTexts, "So that's 42 Maple Street, Atlanta?"],
      address: { street: "42 Maple Street" },
    });
    expect(result).toBeNull();
  });

  it("does not nag for the callback number as if no address existed", () => {
    expect(
      shouldNudgeForCallbackNumber({
        callerTexts: [...early, ...later],
        agentTexts: ["So that's 42 Maple Street, Atlanta?"],
      }),
    ).toBe(true);
  });

  it("tells the model to keep everything else when it does refuse", () => {
    const result = saveBlockedReason({ ...base, callerTexts: ["my sink is clogged"] });
    expect(result?.detail).toContain("do not ask for it again");
  });
});

describe("2026-10-14: an address Grace read back is accepted even when spoken in words", () => {
  it("does not refuse a confirmed address the parser could not read", () => {
    expect(
      saveBlockedReason({
        callerTexts: [
          "sixty one two zero one hundred forty eight drive northeast",
          "redmond 98052",
          "yes",
        ],
        agentTexts: [
          "Is the number you're calling from the best?",
          "So that's 6120 148th Drive Northeast, Redmond?",
        ],
        address: {
          street: "6120 148th Drive Northeast",
          city: "Redmond",
          state: "WA",
          zip: "98052",
        },
        phone: "+18722784999",
      }),
    ).toBeNull();
  });

  it("still refuses an address that was never read back or given", () => {
    expect(
      saveBlockedReason({
        callerTexts: ["my sink is clogged"],
        agentTexts: ["Is the number you're calling from the best?"],
        address: { street: "6120 148th Drive Northeast" },
        phone: "+18722784999",
      })?.error,
    ).toBe("address_needed");
  });
});

/**
 * 2026-10-22 tester call: "I didn't give any issue or problem at all, it just
 * took the name and address and said you are all set, without even asking the
 * problem." Every other part of a complete request had a gate; the reason for
 * the call had none.
 */
describe("leadProblemBlockedReason", () => {
  const askedTwice = ["So what's going on?", "And what's the problem exactly?"];

  it("blocks a lead when the caller never said what was wrong", () => {
    expect(
      leadProblemBlockedReason({
        callerTexts: ["my name is akash", "it's 4512 maple street, 98032", "yes that's right"],
        agentTexts: ["Can I get your name?"],
      })?.error,
    ).toBe("problem_not_described");
  });

  it.each([
    "my kitchen sink is leaking",
    "the toilet is backed up",
    "no hot water since yesterday",
    "I need someone to look at my water heater",
    "nobody showed up for my appointment",
    "I just need a quote",
  ])("allows the save once the caller has said %p", (said) => {
    expect(leadProblemBlockedReason({ callerTexts: [said], agentTexts: [] })).toBeNull();
  });

  it("never traps a caller who cannot say what is wrong", () => {
    expect(
      leadProblemBlockedReason({
        callerTexts: ["I don't know, I just need someone to come look"],
        agentTexts: [],
      }),
    ).toBeNull();
  });

  it("gives up after asking twice rather than looping", () => {
    expect(
      leadProblemBlockedReason({ callerTexts: ["my name is akash"], agentTexts: askedTwice }),
    ).toBeNull();
  });

  it("never blocks a clear emergency, where speed wins", () => {
    expect(
      leadProblemBlockedReason({
        callerTexts: ["there's water everywhere"],
        agentTexts: [],
      }),
    ).toBeNull();
  });
});

/**
 * 2026-10-22, Akash: "instead of asking in between to recheck the details,
 * can he just confirm that details at the end of the call?" The name's
 * letters were read back mid-intake and the number was its own turn.
 */
describe("the closing confirmation", () => {
  it("confirms the name and the number together, in one line", () => {
    const note = callbackNumberNote("+12065550147", { spelled: ["tom"], stated: "Tom" });
    expect(note).toContain("T-O-M");
    expect(note).toContain("206-555-0147");
    expect(note).toContain("exactly two things in one short line");
    expect(note).toContain("Then save");
    // Fires the moment the intake is complete, so it must not claim to be
    // waiting for a later moment that never comes.
    expect(note).toContain("here, before you save");
    expect(note).not.toContain("not earlier");
  });

  it("uses the spelled letters when the caller spelled their name", () => {
    const note = callbackNumberNote("+12065550147", {
      spelled: ["siobhan", "okonkwo"],
      stated: "Siobhan Okonkwo",
    });
    expect(note).toContain("S-I-O-B-H-A-N, O-K-O-N-K-W-O");
  });

  it("does not read the address back again, which was already confirmed in place", () => {
    expect(callbackNumberNote("+12065550147", { spelled: null, stated: "Tom" })).toContain(
      "Do not read the address back again",
    );
  });

  it("confirms the number alone when there is no name to confirm", () => {
    const note = callbackNumberNote("+12065550147", { spelled: null, stated: null });
    expect(note).toContain("confirms ONE thing");
    expect(note).toContain("206-555-0147");
  });
});
