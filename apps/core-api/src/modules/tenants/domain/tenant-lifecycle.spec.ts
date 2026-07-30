import {
  assertValidTenantStatusTransition,
  IllegalTenantStatusTransitionError,
} from "./tenant-lifecycle";

describe("assertValidTenantStatusTransition", () => {
  it("allows trial -> active", () => {
    expect(() => assertValidTenantStatusTransition("trial", "active")).not.toThrow();
  });

  it("allows trial -> expired", () => {
    expect(() => assertValidTenantStatusTransition("trial", "expired")).not.toThrow();
  });

  it("allows the full offboarding path: suspended -> offboarding -> archived", () => {
    expect(() => assertValidTenantStatusTransition("suspended", "offboarding")).not.toThrow();
    expect(() => assertValidTenantStatusTransition("offboarding", "archived")).not.toThrow();
  });

  it("treats a same-status transition as a no-op, not an error", () => {
    expect(() => assertValidTenantStatusTransition("active", "active")).not.toThrow();
  });

  it("rejects archived -> active (archived is terminal)", () => {
    expect(() => assertValidTenantStatusTransition("archived", "active")).toThrow(
      IllegalTenantStatusTransitionError,
    );
  });

  it("rejects trial -> suspended (must go through active first)", () => {
    expect(() => assertValidTenantStatusTransition("trial", "suspended")).toThrow(
      IllegalTenantStatusTransitionError,
    );
  });

  it("rejects expired -> active (an expired trial must go through offboarding)", () => {
    expect(() => assertValidTenantStatusTransition("expired", "active")).toThrow(
      IllegalTenantStatusTransitionError,
    );
  });

  it("includes the from/to statuses on the thrown error for observability", () => {
    try {
      assertValidTenantStatusTransition("archived", "trial");
      throw new Error("expected assertValidTenantStatusTransition to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTenantStatusTransitionError);
      expect((error as IllegalTenantStatusTransitionError).from).toBe("archived");
      expect((error as IllegalTenantStatusTransitionError).to).toBe("trial");
      expect((error as IllegalTenantStatusTransitionError).httpStatus).toBe(409);
    }
  });
});
