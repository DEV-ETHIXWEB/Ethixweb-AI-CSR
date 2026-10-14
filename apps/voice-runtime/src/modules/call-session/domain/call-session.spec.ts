import { ALLOWED_TOOLS } from "./call-session";

describe("ALLOWED_TOOLS", () => {
  it("2026-10-14: offers the human transfer and the emergency check on every live call", () => {
    // transferToHuman was missing from this list, so every "can I talk to a
    // person" on the live line was rejected. Both are safety-critical.
    expect(ALLOWED_TOOLS).toContain("transferToHuman");
    expect(ALLOWED_TOOLS).toContain("escalateEmergency");
  });
});
