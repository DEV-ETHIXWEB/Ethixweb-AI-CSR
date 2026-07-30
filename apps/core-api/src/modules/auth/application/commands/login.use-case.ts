import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../../shared/observability/app-logger.module";
import { authLoginAttemptsCounter } from "../../../../shared/observability/metrics";
import { setSpanAttributes } from "../../../../shared/observability/tracing";
import { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { InvalidCredentialsError, RateLimitExceededError } from "../../domain/errors";
import { JwtTokenService } from "../../infrastructure/jwt-token.service";
import { RATE_LIMITER, type RateLimiter } from "../../domain/ports/rate-limiter.port";
import {
  REFRESH_TOKEN_STORE,
  type RefreshTokenStore,
} from "../../domain/ports/refresh-token-store.port";
import { TOKEN_SERVICE, type TokenService } from "../../domain/ports/token-service.port";
import { USER_REPOSITORY, type UserRepository } from "../../domain/ports/user-repository.port";
import { PasswordHash } from "../../domain/value-objects/password-hash.vo";
import type { PublicUser } from "../../domain/user.entity";
import { toPublicUser } from "../../domain/user.entity";

export interface LoginCommand {
  tenantId: string;
  email: string;
  password: string;
}

export interface LoginResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

// 10 attempts per 15 minutes per (tenant, email) — generous enough that a
// legitimate user fumbling their password a few times is never affected,
// tight enough to make online credential-stuffing against one account
// impractical. Every attempt counts toward the limit (not just failures) —
// a deliberate simplicity choice for Phase 1; differentiating failed vs.
// successful attempts (so a slow-fingered-but-correct user never
// approaches the limit) is a reasonable future enhancement, not required
// for this to be genuine brute-force protection.
// Exported so the test suite can assert against the real threshold instead
// of duplicating a magic number that could silently drift out of sync.
export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

/**
 * `tenantId` is required in the login request itself, not resolved from
 * the email alone — a direct, necessary consequence of RLS (docs/20
 * ADR-013/ADR-014): `users` has no cross-tenant-visible index the app's
 * runtime role could use to answer "which tenant does this email belong
 * to" without already knowing the tenant, and that's a deliberate security
 * property (no email-enumeration-across-tenants surface), not a gap to
 * work around. See docs/20 ADR-015 for the analogous, and different,
 * problem on the API-key path (where a caller truly has no tenant hint at
 * all — a login form, unlike a bearer credential, can always carry one).
 */
@Injectable()
export class LoginUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    @Inject(REFRESH_TOKEN_STORE) private readonly refreshTokenStore: RefreshTokenStore,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    setSpanAttributes({ "ethixweb.tenant_id": command.tenantId });

    const email = command.email.trim().toLowerCase();

    // Checked before any DB query or bcrypt comparison — both are more
    // expensive than a single Redis round-trip, and there's no reason to
    // pay that cost for an attempt that's going to be rejected anyway.
    const rateLimitKey = `login:${command.tenantId}:${email}`;
    const rateLimitResult = await this.rateLimiter.consume(
      rateLimitKey,
      LOGIN_MAX_ATTEMPTS,
      LOGIN_WINDOW_SECONDS,
    );
    if (!rateLimitResult.allowed) {
      authLoginAttemptsCounter.add(1, { outcome: "rate_limited" });
      this.logger.warn("login rate limit exceeded", { tenantId: command.tenantId });
      throw new RateLimitExceededError(rateLimitResult.retryAfterSeconds);
    }

    const user = await this.tenantContext.run(command.tenantId, (db) =>
      this.userRepository.findByEmail(db, command.tenantId, email),
    );

    // Deliberately the same error, and (best-effort) similar timing,
    // whether the email doesn't exist or the password is wrong — see
    // InvalidCredentialsError's own comment on why these are never
    // distinguished at this boundary.
    if (!user) {
      await PasswordHash.timingSafeDummy().verify(command.password);
      authLoginAttemptsCounter.add(1, { outcome: "invalid_credentials" });
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await PasswordHash.fromStoredHash(user.passwordHash).verify(
      command.password,
    );
    if (!passwordMatches) {
      authLoginAttemptsCounter.add(1, { outcome: "invalid_credentials" });
      throw new InvalidCredentialsError();
    }

    await this.tenantContext.run(command.tenantId, (db) =>
      this.userRepository.updateLastLoginAt(db, user.id, new Date()),
    );

    const accessToken = this.tokenService.issueAccessToken({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
    const jti = JwtTokenService.generateJti();
    const refreshToken = this.tokenService.issueRefreshToken({
      sub: user.id,
      jti,
      tenantId: user.tenantId,
    });
    await this.refreshTokenStore.store(user.id, jti, this.tokenService.refreshTokenTtlSeconds);

    setSpanAttributes({ "ethixweb.user_id": user.id });
    authLoginAttemptsCounter.add(1, { outcome: "success" });
    this.logger.info("user logged in", { tenantId: command.tenantId, userId: user.id });

    return { user: toPublicUser(user), accessToken, refreshToken };
  }
}
