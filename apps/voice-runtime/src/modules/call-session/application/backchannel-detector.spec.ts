import { isPureBackchannel } from "./backchannel-detector";

describe("isPureBackchannel", () => {
  it.each([
    ["yeah"],
    ["Yeah."],
    ["okay"],
    ["Okay!"],
    ["right"],
    ["right."],
    ["uh huh"],
    ["uh-huh"],
    ["mm-hmm"],
    ["mm hmm"],
    ["sure"],
    ["alright"],
    ["yep"],
    ["yeah, okay"],
    ["uh huh, right"],
  ])("MISSION EXAMPLE: %p is a pure backchannel and must not take the floor", (transcript) => {
    expect(isPureBackchannel(transcript)).toBe(true);
  });

  it.each([
    ["Wait."],
    ["No, that's not what I meant."],
    ["Actually..."],
    ["Hold on."],
    ["Can you answer my question first?"],
    ["That's not my address."],
    ["Yes, but..."],
    ["yeah but wait"],
    ["right, that's not what I meant"],
    ["okay so my sink is leaking"],
  ])(
    "MISSION EXAMPLE: %p is real speech and MUST interrupt, even when it starts with an ack word",
    (transcript) => {
      expect(isPureBackchannel(transcript)).toBe(false);
    },
  );

  it("empty or whitespace-only transcript is not a backchannel (nothing to classify)", () => {
    expect(isPureBackchannel("")).toBe(false);
    expect(isPureBackchannel("   ")).toBe(false);
  });
});
