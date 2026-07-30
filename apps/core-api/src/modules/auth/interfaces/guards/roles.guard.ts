import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRole } from "@ethixweb/database";
import { InsufficientRoleError } from "../../domain/errors";
import { ROLES_KEY } from "../../../../shared/auth/roles.decorator";
import type { RequestWithPrincipal } from "../../../../shared/auth/request-principal";

/**
 * Registered globally alongside AuthGuard (app.module.ts) but only acts on
 * routes carrying `@Roles(...)` metadata — routes without it are role-
 * unrestricted (any authenticated principal may proceed; per-tenant scoping
 * still applies via `principal.tenantId`, this guard is purely about role).
 * A role-gated route is JWT-only by design: an API-key principal has
 * `scopes`, not a `role`, and management/dashboard actions worth
 * role-gating are exactly the actions this platform doesn't expose to
 * machine API keys at all (docs/08-security-observability-reliability.md
 * §1.1 — API keys are for narrower, scope-gated data access).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const principal = request.principal;

    if (!principal || principal.authType !== "jwt" || !requiredRoles.includes(principal.role)) {
      throw new InsufficientRoleError(
        requiredRoles,
        principal?.authType === "jwt" ? principal.role : "none",
      );
    }

    return true;
  }
}
