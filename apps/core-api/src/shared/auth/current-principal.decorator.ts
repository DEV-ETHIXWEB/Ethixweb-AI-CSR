import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthPrincipal, RequestWithPrincipal } from "./request-principal";

/**
 * `@CurrentPrincipal() principal: AuthPrincipal` in any module's controller
 * method — reads what AuthGuard already attached to the request. Throws
 * (loudly, not silently) if used on a `@Public()` route where no principal
 * exists, which is a programmer error to catch in review/testing, not
 * something to paper over with an optional return type every call site
 * would then need to null-check for no real reason.
 */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const request = ctx.switchToHttp().getRequest<RequestWithPrincipal>();
    if (!request.principal) {
      throw new Error(
        "@CurrentPrincipal() used on a route with no authenticated principal — " +
          "is this route incorrectly marked @Public(), or missing AuthGuard?",
      );
    }
    return request.principal;
  },
);
