import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRole } from "@ethixweb/database";
import { InvalidAccessTokenError } from "../../domain/errors";
import { TOKEN_SERVICE, type TokenService } from "../../domain/ports/token-service.port";
import { AuthenticateApiKeyUseCase } from "../../application/queries/authenticate-api-key.use-case";
import { IS_PUBLIC_KEY } from "../../../../shared/auth/public.decorator";
import type { RequestWithPrincipal } from "../../../../shared/auth/request-principal";

/**
 * Registered globally via `APP_GUARD` (auth.module.ts) — every route
 * requires authentication unless marked `@Public()`. Accepts either an
 * `X-Api-Key` header or an `Authorization: Bearer <jwt>` header, attaching
 * a unified `AuthPrincipal` to the request either way (see
 * shared/auth/request-principal.ts). This is the "tenant-context middleware" from
 * docs/13-implementation-backlog.md's `auth` module §4, implemented as a
 * Guard rather than raw middleware specifically so it can participate in
 * the same Reflector-based metadata pipeline `@Public()`/`@Roles()` use —
 * plain Express/Fastify middleware runs before route metadata is resolved
 * and can't read it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    private readonly authenticateApiKey: AuthenticateApiKeyUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();

    const apiKeyHeader = request.headers["x-api-key"];
    if (typeof apiKeyHeader === "string" && apiKeyHeader.length > 0) {
      const principal = await this.authenticateApiKey.execute(apiKeyHeader);
      request.principal = {
        authType: "api_key",
        tenantId: principal.tenantId,
        apiKeyId: principal.apiKeyId,
        scopes: principal.scopes,
      };
      return true;
    }

    const authHeader = request.headers["authorization"];
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length);
      const payload = this.tokenService.verifyAccessToken(token);
      request.principal = {
        authType: "jwt",
        tenantId: payload.tenantId,
        userId: payload.sub,
        role: payload.role as UserRole,
      };
      return true;
    }

    throw new InvalidAccessTokenError();
  }
}
