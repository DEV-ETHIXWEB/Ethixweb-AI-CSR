import { detailsForTheTeam } from "./details-for-the-team";

// 2026-10-26, the client's test scripts on the production model: a son gave
// his mother's name and separate number, and a caller gave her gate code.
// The saved summary, the only text the team reads, left them out.
describe("detailsForTheTeam", () => {
  const son =
    "My name is Nathaniel Prempeh, P R E M P E H, my number's 206-220-7743, but my mother will be the one home. Her name is Agnes Prempeh, and her number is 206-220-7799, that's a separate line in the house.";

  it("adds the on-site contact the summary left out", () => {
    expect(detailsForTheTeam([son], "Kitchen faucet leaking under the cabinet.")).toBe(
      ' [Caller also said: "Her name is Agnes Prempeh, and her number is 206-220-7799, that\'s a separate line in the house."]',
    );
  });

  it("adds a gate code the summary left out", () => {
    expect(
      detailsForTheTeam(
        ["Rosalind Achterberg, A C H T E R B E R G. 206-552-1187. The gate code is 4471."],
        "Water heater check tomorrow; locked gate.",
      ),
    ).toBe(' [Caller also said: "The gate code is 4471."]');
  });

  it("adds nothing when the summary already has it", () => {
    expect(
      detailsForTheTeam(
        [son],
        "On-site contact: mother Agnes Prempeh, 206-220-7799. Call Nathaniel to confirm.",
      ),
    ).toBe("");
    expect(detailsForTheTeam(["the gate code is four four seven one"], "Gate code 4471.")).toBe("");
  });

  it("adds nothing on an ordinary call", () => {
    expect(
      detailsForTheTeam(
        ["my kitchen sink is leaking", "it's 1215 pine street"],
        "Kitchen sink leak.",
      ),
    ).toBe("");
  });

  it("skips a name that is the caller's own", () => {
    expect(
      detailsForTheTeam(["his name is trevor"], "Water heater replacement quote.", "Trevor"),
    ).toBe("");
  });
});
