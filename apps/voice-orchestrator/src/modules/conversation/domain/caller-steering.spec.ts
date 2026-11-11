import { problemDescribed } from "./save-readiness";
import {
  answerEarnsTransfer,
  insistsOnAPerson,
  TRANSFER_NOW_NOTE,
  asksForAPerson,
  screeningQuestionAsked,
  screenedSinceAskingForAPerson,
  TRANSFER_AFTER_SCREEN_NOTE,
  asksGracesName,
  cannotHearGrace,
  nameCallerGreetedHerWith,
  declinedTheirName,
  declinedAsSales,
  businessWithNoCustomerReason,
  hasWorkReason,
  looksLikeSolicitation,
  offersAddress,
  SCREEN_BEFORE_TRANSFER_NOTE,
  SOLICITATION_NOTE,
  upsetAndWantsAPerson,
} from "./caller-steering";
import { REAL_CALLERS_WHO_WANT_A_PERSON, SPAM_CALLS } from "./spam-calls.corpus";

const askedName = { speaker: "agent", text: "I understand. Can you please share your name?" };

// 2026-11-11, Akash's Oregon test calls: the line broke up and Grace said
// "It sounds like you're feeling confused about communication."
describe("cannotHearGrace", () => {
  it.each([
    "hello grace i'm not able to hear your voice",
    "i don't know grace but i have found that sometimes when you speak something so it just don't come properly to me something like it hallucination is there",
    "i can't hear you",
    "you're breaking up",
    "your voice is cutting out",
    "sorry the line is really bad",
    "hello are you there",
    "i didn't hear anything",
  ])("%p", (said) => {
    expect(cannotHearGrace(said)).toBe(true);
  });
  it.each([
    "i can hear water dripping in the wall",
    "my name is michael",
    "the toilet is making a noise",
    "can you hear me now, my sink is leaking",
    "i heard you have a coupon",
  ])("not %p", (said) => {
    expect(cannotHearGrace(said)).toBe(false);
  });
});

// QA steer-02: "hi chris how are you" got "Chris isn't who you've reached,
// though, this is Grace."
describe("nameCallerGreetedHerWith", () => {
  it.each([
    ["hi chris how are you", "chris"],
    ["hey mike, how's it going", "mike"],
    ["hello sarah", "sarah"],
  ])("%p", (said, name) => {
    expect(nameCallerGreetedHerWith(said)).toBe(name);
  });
  it.each([
    "hi grace how are you",
    "hi there",
    "hi i need a plumber",
    "hello my sink is leaking",
    "hey how are you",
    "hi good morning",
    "hello yes",
    "hi this is mike calling about my sink",
    "my sink is leaking",
  ])("not %p", (said) => {
    expect(nameCallerGreetedHerWith(said)).toBeNull();
  });
});

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
// 2026-11-11, Akash's call: a polite question with "just" in it is not
// impatience; it gets the one screening question.
describe("a polite request with 'just' in it", () => {
  it.each([
    "can i can can you just connect me to the human please",
    "could you just put me through to someone",
    "can you just transfer me",
  ])("is screened, not read as insistent: %p", (said) => {
    expect(asksForAPerson(said)).toBe(true);
    expect(insistsOnAPerson(said)).toBe(false);
  });
});

// QA screen1111-09 on the real model: Grace's ordinary intake question
// ("what's going on with the plumbing?") was counted as the screen, so a
// later bare request for a person went straight through.
describe("screenedSinceAskingForAPerson", () => {
  const turn = (speaker: "caller" | "agent", text: string) => ({ speaker, text });
  it("an intake question before any request for a person is not the screen", () => {
    expect(
      screenedSinceAskingForAPerson([
        turn("caller", "my name is michael"),
        turn("agent", "Nice to meet you, Michael. What's going on with the plumbing?"),
        turn("caller", "m i c h e l"),
      ]),
    ).toBe(false);
  });
  it("the question asked after the request is the screen", () => {
    expect(
      screenedSinceAskingForAPerson([
        turn("caller", "can you connect me to a human"),
        turn("agent", "Sure, what's it about?"),
      ]),
    ).toBe(true);
  });
  it("with no request for a person there is no screen", () => {
    expect(screenedSinceAskingForAPerson([turn("agent", "How can I help?")])).toBe(false);
  });
});

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
    // 2026-11-11, Akash's call, word for word: not recognised, so neither
    // the screen nor the transfer rule ran.
    "can i can can you just connect me to the human please",
    "connect me to a person",
    "can you connect me with someone",
    "please connect me",
    "i want a human",
    "i need to speak with an operator",
    "can i get a live agent",
    "i'd like a representative please",
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
    // Asking whether Grace is a person is the "are you AI" question.
    "is this a human?",
    "am i talking to a human or a robot",
    "are you a real person",
    "can you connect the new faucet to the line",
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
    // 2026-11-11, Akash's call, as transcribed.
    "i'm just from the software company and i just wanted to introduce or like make",
    "we built a software platform for plumbing businesses",
    "I'm with a marketing agency in Seattle",
    "can I book a quick demo with the owner",
  ])("is recognised in %p", (said) => {
    expect(looksLikeSolicitation([said])).toBe(true);
  });

  it.each([
    "my water heater is leaking",
    "I need a quote for a repipe",
    "can someone look at my drain",
    "I'd like to book someone to look at the boiler",
    "I'd like to set up an appointment for my water heater",
    "I'm from the property management company, unit 4 has a leak",
  ])("is not read into %p", (said) => {
    expect(looksLikeSolicitation([said])).toBe(false);
  });
});

describe("a call Grace has already declined as sales", () => {
  it.each([
    "Thanks for reaching out! This line is just for plumbing customers, so I can't pass offers along. Have a great day!",
    "Thanks so much for thinking of us! This line is only for plumbing customers.",
    "I'm sorry, I cannot pass that along.",
  ])("is recognised from %p", (said) => {
    expect(declinedAsSales([said])).toBe(true);
  });

  it.each([
    "Sure, can you tell me what you need help with?",
    "I'll pass that along to the team.",
    "Got it, I'll make sure the plumber gets your message.",
  ])("is not read into %p", (said) => {
    expect(declinedAsSales([said])).toBe(false);
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

  it("2026-11-11, Akash: the decline is warm, thanks them and wishes them well", () => {
    expect(SOLICITATION_NOTE).toContain("warm");
    expect(SOLICITATION_NOTE).toContain("thank them");
    expect(SOLICITATION_NOTE).not.toContain("not interested");
  });
});

/**
 * 2026-11-11, the full sweep (vendor-05): the screen asked its question, the
 * caller said "My water heater is leaking", and Grace asked for their name
 * instead of transferring. The screen only ever fired on the turn the caller
 * ASKED for a person; the turn they answered had no note at all.
 */
describe("the turn the caller answers the screen", () => {
  const earns = (said: string) => answerEarnsTransfer(said, problemDescribed);

  it.each([
    "My water heater is leaking.",
    "I need someone to look at a blocked drain.",
    "It's about an appointment I had on Tuesday.",
    "I want to query a bill I was charged for.",
    "Nobody came out last week.",
  ])("earns the transfer: %p", (said) => {
    expect(earns(said)).toBe(true);
  });

  it.each(["I'd rather not say.", "It's a personal matter."])("does not earn it: %p", (said) => {
    expect(earns(said)).toBe(false);
  });

  it("recognises the screening question Grace was told to ask", () => {
    expect(screeningQuestionAsked(["Sure. What's going on with your plumbing?"])).toBe(true);
    expect(screeningQuestionAsked(["What do you need help with?"])).toBe(true);
    expect(screeningQuestionAsked(["Can I get your name?"])).toBe(false);
  });

  it("tells Grace to transfer on that turn and take nothing else", () => {
    expect(TRANSFER_AFTER_SCREEN_NOTE).toContain("transferToHuman in THIS reply");
    expect(TRANSFER_AFTER_SCREEN_NOTE).toContain("do not take their name");
    expect(TRANSFER_AFTER_SCREEN_NOTE).toContain("never say you cannot transfer");
  });
});

/**
 * 2026-11-11, screen1111-08: "I need to speak to a person right now." The
 * code correctly refused to screen it, but nothing told Grace to transfer,
 * and the prompt's screening exception reads as applying to anyone who has
 * given no reason yet. She asked what it was about anyway.
 */
describe("a request for a person that must not be screened", () => {
  it.each([
    "I need to speak to a person right now.",
    "Just put me through, please.",
    "I already asked to talk to someone.",
    "I said I want to speak to a human.",
    "please just connect me to someone",
  ])("is read as insistent: %p", (said) => {
    expect(insistsOnAPerson(said)).toBe(true);
  });

  it.each(["Can I talk to a person please?", "is the owner available?"])(
    "is not read as insistent: %p",
    (said) => {
      expect(insistsOnAPerson(said)).toBe(false);
    },
  );

  it("tells Grace to transfer at once and ask nothing", () => {
    expect(TRANSFER_NOW_NOTE).toContain("must NOT be screened");
    expect(TRANSFER_NOW_NOTE).toContain("transferToHuman in THIS reply");
    expect(TRANSFER_NOW_NOTE).toContain("do not take");
    expect(TRANSFER_NOW_NOTE).toContain("never say you cannot transfer");
  });
});

describe("2026-11-11 spam corpus: every pitch is caught, no real caller is", () => {
  const isSpam = (texts: readonly string[]) =>
    looksLikeSolicitation(texts) || businessWithNoCustomerReason(texts, problemDescribed);

  it.each(SPAM_CALLS.map((call) => [call.id, call.turns[0] as string]))(
    "%s is recognised from its opening line",
    (_id, opener) => {
      expect(isSpam([opener])).toBe(true);
    },
  );

  it.each(REAL_CALLERS_WHO_WANT_A_PERSON.map((call) => [call.id, call.turns]))(
    "%s is never taken for a sales call",
    (_id, turns) => {
      expect(isSpam(turns)).toBe(false);
    },
  );

  it.each([
    "hi i'm from tacoma, can i speak to the owner",
    "i'm with my tenant right now, can i talk to someone",
    "this is sarah from the front desk at the marriott, can i talk to the owner",
    "i'm calling from work, can i talk to a person",
    "we do need someone out here, can i talk to the owner",
    "calling from the property management company, can i talk to the owner",
    "this is mike from the shop, i need to talk to larry",
    "hey it's jose, one of the techs, put me through to larry",
  ])("an ordinary caller is not a business pitch: %p", (said) => {
    expect(isSpam([said])).toBe(false);
  });
});

describe("a non-customer with a working reason to reach the team", () => {
  it.each([
    "hi, this is mike from ferguson supply about larry's parts order, can i speak to him",
    "this is mike from abc electric, we're on the same job at fifty five elm with larry, i need to talk to him",
    "i'm returning a call from larry, he left me a voicemail",
    "i'm calling about the permit at twelve oak street",
  ])("is recognised in %p", (said) => {
    expect(hasWorkReason([said])).toBe(true);
  });

  it.each(SPAM_CALLS.map((call) => [call.id, call.turns]))(
    "%s has no working reason",
    (_id, turns) => {
      expect(hasWorkReason(turns)).toBe(false);
    },
  );
});
