import { isFarewell } from "./farewell";

describe("isFarewell", () => {
  // The exact utterances from call 6d3893a0, where the caller said
  // goodbye twice and still had to hang up themselves.
  it.each([
    "bye",
    "bye chris",
    "bye bye",
    "goodbye",
    "ok bye",
    "thank you bye",
    "alright take care",
  ])("treats %p as a sign-off", (utterance) => {
    expect(isFarewell(utterance)).toBe(true);
  });

  it("ignores punctuation and casing", () => {
    expect(isFarewell("Bye!")).toBe(true);
    expect(isFarewell("  Goodbye.  ")).toBe(true);
  });

  it.each([
    "let me say bye to my wife and call back",
    "dont say bye yet",
    "wait before you go",
    "no bye is not what i said",
    "actually one more thing bye",
    "hey there",
    "my kitchen pipe is leaking",
    "",
    "   ",
  ])("refuses to end the call on %p", (utterance) => {
    expect(isFarewell(utterance)).toBe(false);
  });

  it("a sign-off phrase buried in a long sentence is not a sign-off", () => {
    expect(isFarewell("i will see you when the technician gets here tomorrow")).toBe(false);
  });

  // Call e41dd948: this sign-off never dropped the line and the caller had
  // to hang up themselves after waiting several seconds.
  it.each([
    "okay i will like call you after some time see you bye",
    "alright thanks so much for your help have a good day",
    "okay perfect i will call you back later bye",
    "thank you so much for your help take care",
    "okay sounds good talk to you later",
  ])("treats the longer real sign-off %p as a farewell", (utterance) => {
    expect(isFarewell(utterance)).toBe(true);
  });

  it.each([
    "the technician said he would see you tomorrow",
    "i just said bye you were supposed to cut the call",
    "my wife wants to know what time you can come out and say bye",
    "before you go can you tell me the price and then bye",
    "no wait i still have one more question before we say goodbye",
  ])("still refuses to end the call on %p", (utterance) => {
    expect(isFarewell(utterance)).toBe(false);
  });

  // Call 9ecc6846: the caller led with "bye" and the call never dropped.
  it.each([
    "bye i just don't want to talk to you",
    "bye i don't need anything else",
    "goodbye and thanks for nothing",
    "okay bye i have to go now",
    "thank you bye i will call later",
  ])("treats the leading sign-off %p as a farewell", (utterance) => {
    expect(isFarewell(utterance)).toBe(true);
  });

  it.each([
    "bye wait one more thing",
    "bye but can you call me back later",
    "goodbye actually hold on",
    "by the way my sink is leaking",
    "by tomorrow would be great",
  ])("does not treat %p as a goodbye", (utterance) => {
    expect(isFarewell(utterance)).toBe(false);
  });
});
