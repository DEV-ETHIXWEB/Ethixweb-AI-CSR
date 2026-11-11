import {
  asksForAPerson,
  asksGracesName,
  declinedTheirName,
  looksLikeSolicitation,
  offersAddress,
  SCREEN_BEFORE_TRANSFER_NOTE,
  SOLICITATION_NOTE,
  upsetAndWantsAPerson,
} from "./caller-steering";

const askedName = { speaker: "agent", text: "I understand. Can you please share your name?" };

// 2026-10-26, Yash's test calls.
describe("declinedTheirName", () => {
  it.each([
    "i don't want to share my screen solution can help me or not not to disturb me on that",
    "i don't want to give my name",
    "i'd rather not say",
    "why do you need my name",
    "no name please just help me",
  ])("%p, answering the name question", (said) => {
    expect(declinedTheirName([askedName, { speaker: "caller", text: said }])).toBe(true);
  });

  it("not when the name question was not the one asked", () => {
    expect(
      declinedTheirName([
        { speaker: "agent", text: "Do you want the technician to call first?" },
        { speaker: "caller", text: "i don't want to give them a call" },
      ]),
    ).toBe(false);
  });

  it("not when they gave it", () => {
    expect(declinedTheirName([askedName, { speaker: "caller", text: "it's yash patel" }])).toBe(
      false,
    );
  });
});

describe("asksGracesName", () => {
  it.each([
    "my address is thirty seven what was your name again",
    "who am i speaking with",
    "sorry what's your name",
  ])("%p", (said) => {
    expect(asksGracesName(said)).toBe(true);
  });
  it.each(["what was my name again", "my name is walter", "can you repeat my name"])(
    "not %p",
    (said) => {
      expect(asksGracesName(said)).toBe(false);
    },
  );
});

describe("offersAddress", () => {
  it.each([
    "my address is my address is thirty seven",
    "i live at forty two pine",
    "the address is 1215 north 92nd",
  ])("%p", (said) => {
    expect(offersAddress(said)).toBe(true);
  });
  it.each(["what's the address of your office", "i already gave you my address"])(
    "not %p",
    (said) => {
      expect(offersAddress(said)).toBe(false);
    },
  );
});

describe("upsetAndWantsAPerson", () => {
  it.each([
    "you guys charged me four hundred bucks and the leak is back again, this is ridiculous. i want my money back and i want to talk to the owner right now",
    "nobody showed up yesterday, let me speak to a manager",
  ])("%p", (said) => {
    expect(upsetAndWantsAPerson(said)).toBe(true);
  });
  it.each(["can i talk to a person please", "this is ridiculous, my sink is leaking again"])(
    "not %p",
    (said) => {
      expect(upsetAndWantsAPerson(said)).toBe(false);
    },
  );
});

/**
 * 2026-11-11, the client: every caller who asked for a human was put
 * straight through, and the on-call phone was ringing for marketing and SEO
 * pitches.
 *
 * The exclusions matter more than the screen. Vendor calls on 2026-10-10
 * and 10-11 had three requests for a human ignored, which is why the
 * "transfer at once, ask nothing" rule exists at all. Anyone who has said
 * what is wrong keeps that. Only a request with nothing behind it is
 * screened, and only once.
 */
describe("asking for a person", () => {
  it.each([
    "Just give me a human please.",
    "Can I talk to a real person please?",
    "I want to talk to a real person right now.",
    "Can I speak to someone else? I need to talk to a person right now.",
    "put me through to the owner",
    "transfer me to a manager",
    // The sales openers, which are the reason this exists.
    "is the owner available?",
    "who handles your marketing?",
    "can I speak to whoever is in charge of advertising",
  ])("is recognised in %p", (said) => {
    expect(asksForAPerson(said)).toBe(true);
  });

  it.each([
    // Asking for a technician to be SENT is a service request, not a
    // request to be put through to someone.
    "can you send a person out to fix it?",
    "is someone coming out today?",
    "what time does someone arrive",
    "my kitchen sink is leaking",
  ])("is not read into %p", (said) => {
    expect(asksForAPerson(said)).toBe(false);
  });
});

describe("a pitch aimed at the business", () => {
  it.each([
    "Hi, I'm calling about your Google Business listing",
    "we help contractors like you get more leads",
    "I wanted to talk about your SEO",
    "quick question about your business",
    "we do payment processing for plumbers",
  ])("is recognised in %p", (said) => {
    expect(looksLikeSolicitation([said])).toBe(true);
  });

  it.each([
    "my water heater is leaking",
    "I need a quote for a repipe",
    "can someone look at my drain",
    "I'd like to book someone to look at the boiler",
  ])("is not read into %p", (said) => {
    expect(looksLikeSolicitation([said])).toBe(false);
  });
});

describe("what Grace is told in each case", () => {
  it("screens with one question and never sounds like a refusal", () => {
    expect(SCREEN_BEFORE_TRANSFER_NOTE).toContain("Ask ONE short");
    expect(SCREEN_BEFORE_TRANSFER_NOTE).toContain("do not say you cannot");
    // The point is to learn why they called, not to vet them.
    expect(SCREEN_BEFORE_TRANSFER_NOTE).toContain("transfer immediately on that turn");
  });

  it("declines a pitch without transferring it or filing it", () => {
    expect(SOLICITATION_NOTE).toContain("Do not transfer and do not save a request");
    expect(SOLICITATION_NOTE).toContain("never rude");
  });
});
