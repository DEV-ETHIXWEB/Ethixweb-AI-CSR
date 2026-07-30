import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "@ethixweb/database";

export const ROLES_KEY = "roles";

/**
 * `@Roles('owner', 'admin')` — enforced by RolesGuard
 * (modules/auth/interfaces/guards/roles.guard.ts), per
 * docs/08-security-observability-reliability.md §1.1's role list
 * (owner/admin/dispatcher/viewer). Lives in `shared/` for the same reason
 * as `Public` — every module's controllers need it, not just `auth`'s own.
 * Only meaningful on JWT-authenticated requests; an API-key-authenticated
 * request has scopes, not a role, and RolesGuard rejects it outright on
 * any role-gated route.
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
