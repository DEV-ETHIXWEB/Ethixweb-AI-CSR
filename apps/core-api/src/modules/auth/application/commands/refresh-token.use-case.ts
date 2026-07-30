import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../../shared/observability/app-logger.module";
import { authRefreshTokenRotationsCounter } from "../../../../shared/observability/metrics";
import { setSpanAttributes } from "../../../../shared/observability/tracing";
import { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { InvalidRefreshTokenError, UserNotFoundError } from "../../domain/errors";
import { JwtTokenService } from "../../infrastructure/jwt-token.service";
import {
  REFRESH_TOKEN_STORE,
  type RefreshTokenStore,
} from "../../domain/ports/refresh-token-store.port";
import { TOKEN_SERVICE, type TokenService } from "../../domain/ports/token-service.port";
import { USER_REPOSITORY, type UserRepository } from "../../domain/ports/user-repository.port";

export interface RefreshTokenResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Rotating refresh: every use of a refresh token invalidates it and issues
 * a new one, per docs/13-implementation-backlog.md "auth" module §1. This
 * means a stolen-and-reused refresh token is detectable — if the
 * legitimate client and an attacker both try to use the same
 * (now-rotated-away) token, the second one to arrive gets
 * InvalidRefreshTokenError, which a real production system would treat as
 * a compromise signal worth alerting on (tracked as a follow-up, not built
 * here — this use-case's job is correct rotation, not intrusion detection).
 */
@Injectable()
export class RefreshTokenUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    @Inject(REFRESH_TOKEN_STORE) private readonly refreshTokenStore: RefreshTokenStore,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(refreshToken: string): Promise<RefreshTokenResult> {
    const payload = this.tokenService.verifyRefreshToken(refreshToken);
    setSpanAttributes({
      "ethixweb.tenant_id": payload.tenantId,
      "ethixweb.user_id": payload.sub,
    });

    // Atomic check-and-invalidate — see RefreshTokenStore.consume()'s own
    // comment on the TOCTOU race a separate isValid()+revoke() pair has
    // under concurrent use of the same token. Whether or not the user
    // lookup below succeeds, the old token is already dead the instant
    // this returns true, so there's nothing left to revoke on any later
    // branch (including "user not found").
    const consumed = await this.refreshTokenStore.consume(payload.sub, payload.jti);
    if (!consumed) {
      authRefreshTokenRotationsCounter.add(1, { outcome: "invalid_token" });
      throw new InvalidRefreshTokenError();
    }

    // Re-fetch the user rather than trusting the token's claims blindly —
    // a role change or tenant suspension since the token was issued must
    // take effect on the very next refresh, not only once the short-lived
    // access token's own TTL happens to expire.
    const user = await this.tenantContext.run(payload.tenantId, (db) =>
      this.userRepository.findById(db, payload.tenantId, payload.sub),
    );
    if (!user) {
      authRefreshTokenRotationsCounter.add(1, { outcome: "user_not_found" });
      throw new UserNotFoundError(payload.sub);
    }

    const accessToken = this.tokenService.issueAccessToken({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
    const newJti = JwtTokenService.generateJti();
    const newRefreshToken = this.tokenService.issueRefreshToken({
      sub: user.id,
      jti: newJti,
      tenantId: user.tenantId,
    });
    await this.refreshTokenStore.store(user.id, newJti, this.tokenService.refreshTokenTtlSeconds);

    authRefreshTokenRotationsCounter.add(1, { outcome: "success" });
    this.logger.info("refresh token rotated", { tenantId: user.tenantId, userId: user.id });

    return { accessToken, refreshToken: newRefreshToken };
  }
}
