import {
  callbackNumberNote,
  isHardEmergency,
  leadProblemBlockedReason,
  saveBlockedReason,
  shouldNudgeForCallbackNumber,
  readsBackStreet,
  zipMissingNote,
  NUMBER_ASKED,
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
          agentTexts: [
            "What's your address?",
            "So that's 1200 Pine Street?",
            "So that's 2-0-6-5-5-5-0-1-8-4?",
          ],
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
    callerTexts: ["my toilet runs", "it's 1200 Pine Street, Seattle 98101"],
    agentTexts: [
      "Can I get your name?",
      "What's your address?",
      "So that's 1200 Pine Street, Seattle?",
    ],
  };

  /**
   * The QA 2026-10-13 version of this waited for Grace to have read the
   * address back first. That precondition went with the mid-call readback it
   * was waiting on (2026-10-22, client call: confirm the address once at the
   * end): this note now DOES the readback, so waiting for one would deadlock
   * and the call would never reach any confirmation at all.
   */
  it("no longer waits for a read-back that now happens inside this note", () => {
    expect(
      shouldNudgeForCallbackNumber({
        ...base2,
        agentTexts: ["Can I get your name?", "What's your address?"],
      }),
    ).toBe(true);
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
  /**
   * 2026-10-23, client decision: two short questions instead of one line. A
   * caller said of the one-line version "how can I understand if you speak
   * the address and number at once".
   */
  it("first asks about the name and the address only, with no phone number", () => {
    const note = callbackNumberNote(
      "+12065550147",
      { spelled: ["tom"], stated: "Tom" },
      { street: "4512 maple street", zip: "98032" },
    );
    expect(note).toContain("T-O-M");
    expect(note).toContain("4-5-1-2 maple street");
    expect(note).toContain("ZIP 9-8-oh-3-2");
    expect(note).toContain("ONLY the first");
    expect(note).not.toContain("206-555-0147");
  });

  it("then, once Grace has read those back, asks about the number on its own", () => {
    const note = callbackNumberNote(
      "+12065550147",
      { spelled: ["tom"], stated: "Tom" },
      { street: "4512 maple street", zip: "98032" },
      [
        "Let me make sure I have it right: Tom, T-O-M, at 4-5-1-2 Maple Street, ZIP 9-8-oh-3-2. Is that right?",
      ],
    );
    expect(note).toContain("206-555-0147");
    expect(note).toContain("ONE thing");
    expect(note).not.toContain("4-5-1-2");
  });

  it("with no street, the name's spelling is the whole first question", () => {
    const name = { spelled: null, stated: "Omar" };
    expect(callbackNumberNote("+12065550147", name, { street: null, zip: null })).toContain(
      "ONLY the first",
    );
    expect(
      callbackNumberNote("+12065550147", name, { street: null, zip: null }, [
        "So that's Omar, O-M-A-R?",
      ]),
    ).toContain("206-555-0147");
  });

  it("uses the spelled letters when the caller spelled their name", () => {
    const note = callbackNumberNote("+12065550147", {
      spelled: ["siobhan", "okonkwo"],
      stated: "Siobhan Okonkwo",
    });
    expect(note).toContain("S-I-O-B-H-A-N, O-K-O-N-K-W-O");
  });

  /**
   * The reverse of what this asserted before 2026-10-22. The address used to
   * be confirmed when it was taken and then explicitly NOT repeated here;
   * the client asked for the opposite, so this is the one place it is read
   * back, and it must say so.
   */
  it("is the only place the address is confirmed, and says so", () => {
    const note = callbackNumberNote(
      "+12065550147",
      { spelled: null, stated: "Tom" },
      { street: "4512 maple street", zip: null },
    );
    expect(note).toContain("ONLY time the name and address are confirmed");
    expect(note).toContain("4-5-1-2 maple street");
  });

  it("confirms the number alone when there is no name to confirm", () => {
    const note = callbackNumberNote("+12065550147", { spelled: null, stated: null });
    expect(note).toContain("confirms ONE thing");
    expect(note).toContain("206-555-0147");
  });
});

/**
 * 2026-10-22, reviewing the whole tester backlog: "I mentioned that there's
 * an active overflow still and asked that can someone come today but it just
 * gives a generic response."
 *
 * Every other list that decides urgency already carried "overflow"; this one
 * did not, so an active overflow was the single phrasing that would not
 * relax the save gate for speed.
 */
describe("an active overflow counts as an emergency", () => {
  it.each([
    ["there is an active overflow still"],
    ["the toilet is overflowing right now"],
    ["it overflowed all over the floor"],
  ])("treats %p as a hard emergency", (said) => {
    expect(isHardEmergency([said])).toBe(true);
  });

  it("still does not treat an ordinary drip as one", () => {
    expect(isHardEmergency(["my water heater is leaking a little"])).toBe(false);
  });
});

/**
 * 2026-10-23 client calls: Grace asked for the callback number in words the
 * check did not know, the save was refused as "callback number not
 * confirmed", and she asked the same caller again. Twice, in two calls.
 */
describe("the callback question is recognized however Grace phrases it", () => {
  it.each([
    [
      "[slowly] Got it! Is the number you're calling from, 8-7-2-2-7-8-4-9-9-9, the best one to reach you?",
    ],
    [
      "Thanks, Omar Hadad. [slowly] Is the number we're talking on the best one to reach you, 8-7-2-2-7-8-4-9-9-9?",
    ],
  ])("counts %p as asking", (agentText) => {
    expect(NUMBER_ASKED.test(agentText)).toBe(true);
  });
});

/** 2026-10-23 client call: the address was read back with "ZIP unknown" while the caller was still giving it. */
describe("zipMissingNote", () => {
  const named = [
    "my name is nora kessler",
    "the house number is one seven four eight",
    "westlake avenue unit four",
  ];

  it("asks for the ZIP before anything is read back", () => {
    expect(
      zipMissingNote({ callerTexts: named, agentTexts: ["What's the street name?"] }),
    ).toContain("ask for the ZIP code");
    expect(
      shouldNudgeForCallbackNumber({ callerTexts: named, agentTexts: ["What's your name?"] }),
    ).toBe(false);
  });

  it("stops once the ZIP is given, in or out of the area", () => {
    expect(
      zipMissingNote({ callerTexts: [...named, "nine eight one two one"], agentTexts: [] }),
    ).toBeNull();
    expect(zipMissingNote({ callerTexts: [...named, "it's 30301"], agentTexts: [] })).toBeNull();
  });

  it("asks only once, and not after the caller says they don't know it", () => {
    expect(
      zipMissingNote({
        callerTexts: [...named, "in seattle"],
        agentTexts: ["What's the ZIP code?"],
      }),
    ).toBeNull();
    expect(
      zipMissingNote({ callerTexts: [...named, "i don't know the zip"], agentTexts: [] }),
    ).toBeNull();
  });
});

/** QA 2026-10-23 (feedback-15): a new number was saved without ever being said back. */
describe("a number the caller gives is read back before it is saved", () => {
  const args = {
    callerTexts: ["it's 1200 Pine Street, Seattle 98101", "please call me on 206 555 0147 instead"],
    address: { street: "1200 Pine Street" },
    phone: "+12065550147",
  };

  it("refuses the save until Grace has said the new number back", () => {
    expect(
      saveBlockedReason({
        ...args,
        agentTexts: ["Let me make sure I have it right: 1-2-oh-oh Pine Street. Is that right?"],
      })?.error,
    ).toBe("new_callback_number_not_read_back");
  });

  it("accepts it once she has, however she wrote the digits", () => {
    expect(
      saveBlockedReason({
        ...args,
        agentTexts: [
          "Let me make sure I have it right: 1-2-oh-oh Pine Street. Is that right?",
          "Got it, 2-0-6-5-5-5-oh-1-4-7. Is that right?",
        ],
      }),
    ).toBeNull();
  });
});

/** 2026-10-23 live call: these were not recognized, the save was refused five times, and nothing was saved. */
describe("more ways of asking for the callback number", () => {
  it.each([
    ["Thanks, Peter. Just to confirm, is the number you called from the best way to reach you?"],
    ["Is there a different number you'd like me to use, or is the one you called from the best?"],
  ])("counts %p", (text) => {
    expect(NUMBER_ASKED.test(text)).toBe(true);
  });
});

/** 2026-10-23 live calls: the confirmation steps as they really went. */
describe("the closing confirmation holds whatever order Grace takes it in", () => {
  it("Peter: the address read back without the name in the same breath completes the first step", () => {
    const note = callbackNumberNote(
      "+18722784999",
      { spelled: null, stated: "Peter Parker" },
      { street: "3015 south jackson street", zip: "98114" },
      [
        "Thanks, Peter! Can you provide your street address, please?",
        "Got it. Let me confirm your address: 3-oh-1-5 South Jackson Street, Seattle, Washington, ZIP 98114. Is that right?",
      ],
    );
    expect(note).toContain("872-278-4999");
    expect(note).not.toContain("ONLY the first");
  });

  it("Mary Jane: echoing the house number while asking for the street is not a readback", () => {
    expect(
      readsBackStreet(
        "What's the street name for twelve fifteen?",
        "1215 north ninety second street",
        null,
      ),
    ).toBe(false);
    expect(
      readsBackStreet(
        "Let me make sure I have it right: Mary Jane, at 1-2-1-5 North Ninety Second Street, ZIP 9-8-1-oh-3.",
        "1215 north ninety second street",
        "98103",
      ),
    ).toBe(true);
  });

  it("Mary Jane: asking for the number first does not skip the name and address", () => {
    const args = {
      callerTexts: [
        "the morning when i went there for a bath the water heater was not heating the water",
        "yeah sure it's mary jane",
        "the address is twelve fifteen",
        "north ninety second street seattle washington ninety second street",
        "seattle washington nine eight one zero three",
      ],
      agentTexts: [
        "Got it, your water heater isn't heating water. Can I have your name, please?",
        "Got it, Mary Jane. What's the street address for the water heater?",
        "What's the street name for twelve fifteen?",
        "Mary Jane, is this number you're calling from, 8-7-2-2-7-8-4-9-9-9, the best number to reach you?",
      ],
    };
    expect(shouldNudgeForCallbackNumber(args)).toBe(true);
    expect(
      saveBlockedReason({
        ...args,
        address: { street: "1215 North Ninety Second Street", zip: "98103" },
      })?.error,
    ).toBe("address_not_confirmed");
  });

  it("Sarah: the number question never tells Grace to save on the same turn", () => {
    const note = callbackNumberNote(
      "+18722784999",
      { spelled: null, stated: "Sarah Miller" },
      { street: "200 northwest fiftieth street", zip: "98101" },
      [
        "Let me make sure I have it right: Sarah, S-A-R-A-H, Miller, at 2-oh-oh Northwest Fiftieth Street, ZIP 9-8-1-0-1. Is that right?",
      ],
    );
    expect(note).toContain("Do not save on this turn");
    expect(note).not.toContain("Then save");
  });
});

/** 2026-10-23 live call: a missed appointment could not be saved, "the caller never said what was wrong". */
describe("a missed appointment is a reason to call", () => {
  it.each([
    [
      "hi this is victor and i'm calling back because i had a technician scheduled for yesterday afternoon and nobody showed up or called",
    ],
    ["the plumber never came"],
    ["no one showed up yesterday"],
  ])("%p", (said) => {
    expect(leadProblemBlockedReason({ callerTexts: [said], agentTexts: [] })).toBeNull();
  });
});
