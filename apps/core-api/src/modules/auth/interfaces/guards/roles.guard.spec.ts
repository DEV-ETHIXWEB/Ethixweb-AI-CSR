import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { UserRole } from "@ethixweb/database";
import type {
  AuthPrincipal,
  RequestWithPrincipal,
} from "../../../../shared/auth/request-principal";
import { InsufficientRoleError } from "../../domain/errors";
import { RolesGuard } from "./roles.guard";

function buildContext(principal: AuthPrincipal | undefined): ExecutionContext {
  const request: RequestWithPrincipal = { principal } as RequestWithPrincipal;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (): void => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function buildReflector(requiredRoles: UserRole[] | undefined): Reflector {
  return { getAllAndOverride: () => requiredRoles } as unknown as Reflector;
}

describe("RolesGuard", () => {
  it("allows any authenticated principal through when no @Roles() metadata is present", () => {
    const guard = new RolesGuard(buildReflector(undefined));
    const context = buildContext({ authType: "jwt", tenantId: "t1", userId: "u1", role: "viewer" });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("allows a JWT principal whose role matches one of the required roles", () => {
    const guard = new RolesGuard(buildReflector(["owner", "admin"]));
    const context = buildContext({ authType: "jwt", tenantId: "t1", userId: "u1", role: "admin" });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects a JWT principal whose role isn't in the required list", () => {
    const guard = new RolesGuard(buildReflector(["owner"]));
    const context = buildContext({ authType: "jwt", tenantId: "t1", userId: "u1", role: "viewer" });

    expect(() => guard.canActivate(context)).toThrow(InsufficientRoleError);
  });

  it("rejects an api_key principal outright on any role-gated route, even with matching scopes", () => {
    const guard = new RolesGuard(buildReflector(["owner", "admin"]));
    const context = buildContext({
      authType: "api_key",
      tenantId: "t1",
      apiKeyId: "k1",
      scopes: "full",
    });

    expect(() => guard.canActivate(context)).toThrow(InsufficientRoleError);
  });

  it("rejects a missing principal on a role-gated route", () => {
    const guard = new RolesGuard(buildReflector(["owner"]));
    const context = buildContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(InsufficientRoleError);
  });
});
