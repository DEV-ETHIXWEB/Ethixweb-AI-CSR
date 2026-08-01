import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { InvalidServiceTokenError } from "./service-auth.errors";
import type { RequestWithServicePrincipal } from "./service-principal";

/**
 * Registered globally (app.module.ts) — every route requires a valid
 * `Authorization: Bearer <ORCHESTRATOR_SERVICE_TOKEN>` header unless marked
 * `@Public()` (health checks). A single shared secret, not per-tenant API
 * keys: this service's callers are other SERVICES (Voice Runtime, core-api),
 * not tenant-scoped human/dashboard sessions — see
 * shared/auth/service-principal.ts's own comment on why tenant scoping is
 * handled differently here than in apps/core-api. Constant-time comparison
 * (`timingSafeEqual`) for the same reason apps/core-api's password/API-key
 * checks are — a shared secret is exactly the kind of value a timing
 * side-channel could leak.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithServicePrincipal>();
    const authHeader = request.headers["authorization"];
    const expectedToken = process.env["ORCHESTRATOR_SERVICE_TOKEN"];

    if (
      !expectedToken ||
      typeof authHeader !== "string" ||
      !authHeader.startsWith("Bearer ") ||
      !constantTimeEquals(authHeader.slice("Bearer ".length), expectedToken)
    ) {
      throw new InvalidServiceTokenError();
    }

    request.servicePrincipal = { serviceName: "unknown" };
    return true;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
