import { assertCanAssignRole, CannotAssignRoleError } from "./role-assignment-policy";

describe("assertCanAssignRole", () => {
  it.each(["owner", "admin", "dispatcher", "viewer"] as const)(
    "owner can assign %s",
    (targetRole) => {
      expect(() => assertCanAssignRole("owner", targetRole)).not.toThrow();
    },
  );

  it.each(["admin", "dispatcher", "viewer"] as const)("admin can assign %s", (targetRole) => {
    expect(() => assertCanAssignRole("admin", targetRole)).not.toThrow();
  });

  it("admin CANNOT assign owner", () => {
    expect(() => assertCanAssignRole("admin", "owner")).toThrow(CannotAssignRoleError);
  });

  it.each(["owner", "admin", "dispatcher", "viewer"] as const)(
    "dispatcher can assign nothing (%s rejected)",
    (targetRole) => {
      expect(() => assertCanAssignRole("dispatcher", targetRole)).toThrow(CannotAssignRoleError);
    },
  );

  it.each(["owner", "admin", "dispatcher", "viewer"] as const)(
    "viewer can assign nothing (%s rejected)",
    (targetRole) => {
      expect(() => assertCanAssignRole("viewer", targetRole)).toThrow(CannotAssignRoleError);
    },
  );

  it("the thrown error carries both roles and a 403 status", () => {
    try {
      assertCanAssignRole("admin", "owner");
      throw new Error("expected assertCanAssignRole to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CannotAssignRoleError);
      const typed = error as CannotAssignRoleError;
      expect(typed.actingRole).toBe("admin");
      expect(typed.targetRole).toBe("owner");
      expect(typed.httpStatus).toBe(403);
    }
  });
});
