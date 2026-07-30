import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../../shared/observability/app-logger.module";
import {
  REFRESH_TOKEN_STORE,
  type RefreshTokenStore,
} from "../../domain/ports/refresh-token-store.port";
import { TOKEN_SERVICE, type TokenService } from "../../domain/ports/token-service.port";

/**
 * Single-session logout: revokes only the refresh token presented. A
 * stolen access token already in an attacker's hands still expires on its
 * own short TTL (15 min default) — immediate access-token revocation isn't
 * offered here since JWTs are stateless by design (no server-side lookup on
 * every request is the whole point). "Logout everywhere" (revokeAll) is
 * available on RefreshTokenStore for a future admin/security action but
 * isn't wired to an endpoint yet — no requirement in
 * docs/13-implementation-backlog.md calls for it at this stage.
 */
@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    @Inject(REFRESH_TOKEN_STORE) private readonly refreshTokenStore: RefreshTokenStore,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(refreshToken: string): Promise<void> {
    // Verification failing (already expired/invalid/malformed) is not an
    // error worth surfacing here — the caller's goal ("make sure this
    // session is dead") is already satisfied either way, so logout is
    // idempotent by design rather than throwing on an already-invalid token.
    try {
      const payload = this.tokenService.verifyRefreshToken(refreshToken);
      await this.refreshTokenStore.revoke(payload.sub, payload.jti);
      this.logger.info("user logged out", { userId: payload.sub, tenantId: payload.tenantId });
    } catch {
      // Already invalid/expired — nothing to revoke, and that's success.
    }
  }
}
