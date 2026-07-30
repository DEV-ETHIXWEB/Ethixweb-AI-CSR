import type { UserRole } from "@ethixweb/database";
import { ForbiddenDomainError } from "../../../shared/domain/domain-error";

/**
 * Closes a real privilege-escalation gap found during review: `POST
 * /auth/users` is gated `@Roles("owner", "admin")` at the controller, but
 * nothing previously stopped an `admin` (not an `owner`) from setting
 * `role: "owner"` in the request body and minting a brand-new owner
 * account for themselves or an accomplice — `@Roles()` only checks who is
 * *calling*, never what privilege the call is trying to *grant*. An
 * explicit, tested policy function, the same discipline already applied to
 * the tenant lifecycle state machine (docs/15 §2), rather than an inline
 * `if` easy to miss on the next change to this endpoint.
 */
const ASSIGNABLE_ROLES: Record<UserRole, readonly UserRole[]> = {
  owner: ["owner", "admin", "dispatcher", "viewer"],
  admin: ["admin", "dispatcher", "viewer"],
  dispatcher: [],
  viewer: [],
};

export class CannotAssignRoleError extends ForbiddenDomainError {
  constructor(
    public readonly actingRole: UserRole,
    public readonly targetRole: UserRole,
  ) {
    super(`Role "${actingRole}" cannot grant role "${targetRole}".`);
    this.name = "CannotAssignRoleError";
  }
}

export function assertCanAssignRole(actingRole: UserRole, targetRole: UserRole): void {
  if (!ASSIGNABLE_ROLES[actingRole].includes(targetRole)) {
    throw new CannotAssignRoleError(actingRole, targetRole);
  }
}
