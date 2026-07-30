import type { UserRole } from "@ethixweb/database";
import type { FastifyRequest } from "fastify";

/**
 * The unified shape AuthGuard (modules/auth/interfaces/guards/auth.guard.ts)
 * attaches to every authenticated request, regardless of which credential
 * type was presented — everything downstream (RolesGuard, controllers in
 * any module, `TenantContextService.run()`) reads `principal.tenantId` the
 * same way whether the caller used a JWT or an API key. This is the
 * concrete implementation of the "tenant-context middleware" item in
 * docs/13-implementation-backlog.md's `auth` module §4. Lives in `shared/`
 * (a pure type, zero runtime dependencies) so every module's controllers
 * can use `@CurrentPrincipal()` without depending on `auth`'s internals.
 */
export type AuthPrincipal =
  | { authType: "jwt"; tenantId: string; userId: string; role: UserRole }
  | { authType: "api_key"; tenantId: string; apiKeyId: string; scopes: string };

export interface RequestWithPrincipal extends FastifyRequest {
  principal?: AuthPrincipal;
}
