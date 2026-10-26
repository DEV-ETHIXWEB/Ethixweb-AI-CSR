import { mentionsGasLeak } from "./gas-leak";

// 2026-10-26, Yash's test call: a gas leak with kids upstairs. Grace asked
// for his name and whether it was happening right now, and only said to leave
// the building when he asked "what should I do here".
describe("mentionsGasLeak", () => {
  it.each([
    "the gas is leaking aggressively",
    "the gas is leaving you to go to extreme like aggressively",
    "i smell gas in the kitchen",
    "it smells like gas",
    "there's a gas smell near the stove",
    "i can hear gas hissing from the line",
    "gas is escaping from the meter",
    "we have a gas leak and a pipe burst",
    "something is leaking gas",
  ])("%p", (said) => {
    expect(mentionsGasLeak(said)).toBe(true);
  });

  it.each([
    "my gas water heater is leaking",
    "the gas water heater is leaking water all over the floor",
    "i want a new gas line for my grill",
    "my gas stove won't light",
    "the gas bill is too high",
    "there's no gas smell, just water",
  ])("not %p", (said) => {
    expect(mentionsGasLeak(said)).toBe(false);
  });
});
