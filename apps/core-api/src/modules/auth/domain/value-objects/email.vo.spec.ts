import { Email, InvalidEmailError } from "./email.vo";

describe("Email", () => {
  it("normalizes case and surrounding whitespace", () => {
    const email = Email.create("  Owner@AllPhasePlumbing.com  ");
    expect(email.toString()).toBe("owner@allphaseplumbing.com");
  });

  it("treats two emails differing only by case/whitespace as equal", () => {
    const a = Email.create("Owner@Example.com");
    const b = Email.create(" owner@example.com ");
    expect(a.equals(b)).toBe(true);
  });

  it("rejects a string with no @", () => {
    expect(() => Email.create("not-an-email")).toThrow(InvalidEmailError);
  });

  it("rejects a string with no domain", () => {
    expect(() => Email.create("owner@")).toThrow(InvalidEmailError);
  });

  it("rejects an empty string", () => {
    expect(() => Email.create("")).toThrow(InvalidEmailError);
  });
});
