import type { LeadStatus } from "@ethixweb/database";
import {
  assertValidLeadStatusTransition,
  IllegalLeadStatusTransitionError,
} from "./lead-lifecycle";

const ALL_STATUSES: LeadStatus[] = [
  "new",
  "notified",
  "claimed",
  "converted_to_job",
  "expired",
  "duplicate",
  "abandoned",
];

const VALID_TRANSITIONS: Array<[LeadStatus, LeadStatus]> = [
  ["new", "notified"],
  ["new", "duplicate"],
  ["new", "abandoned"],
  ["notified", "claimed"],
  ["notified", "expired"],
  ["notified", "duplicate"],
  ["notified", "abandoned"],
  ["claimed", "converted_to_job"],
  ["claimed", "expired"],
  ["claimed", "abandoned"],
];

describe("assertValidLeadStatusTransition", () => {
  it.each(VALID_TRANSITIONS)("allows %s -> %s", (from, to) => {
    expect(() => assertValidLeadStatusTransition(from, to)).not.toThrow();
  });

  it.each(ALL_STATUSES)(
    "treats a same-status transition (%s -> %s) as an idempotent no-op",
    (status) => {
      expect(() => assertValidLeadStatusTransition(status, status)).not.toThrow();
    },
  );

  it.each(["converted_to_job", "expired", "duplicate", "abandoned"] as LeadStatus[])(
    "rejects any transition out of the terminal status %s",
    (terminal) => {
      for (const to of ALL_STATUSES) {
        if (to === terminal) {
          continue;
        }
        expect(() => assertValidLeadStatusTransition(terminal, to)).toThrow(
          IllegalLeadStatusTransitionError,
        );
      }
    },
  );

  it("rejects skipping straight from new to converted_to_job", () => {
    expect(() => assertValidLeadStatusTransition("new", "converted_to_job")).toThrow(
      IllegalLeadStatusTransitionError,
    );
  });

  it("rejects going backwards from claimed to notified", () => {
    expect(() => assertValidLeadStatusTransition("claimed", "notified")).toThrow(
      IllegalLeadStatusTransitionError,
    );
  });

  it("error carries the from/to statuses for callers that need to branch on it", () => {
    try {
      assertValidLeadStatusTransition("expired", "claimed");
      throw new Error("expected assertValidLeadStatusTransition to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalLeadStatusTransitionError);
      const illegal = error as IllegalLeadStatusTransitionError;
      expect(illegal.from).toBe("expired");
      expect(illegal.to).toBe("claimed");
      expect(illegal.httpStatus).toBe(409);
    }
  });
});
