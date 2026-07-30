import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InvalidAccessTokenError, InvalidRefreshTokenError } from "../domain/errors";
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
  TokenService,
} from "../domain/ports/token-service.port";

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

// jsonwebtoken infers an allow-list from the key type when `algorithms`
// isn't passed to verify() (HS* for a plain string secret, never `none` —
// confirmed against jsonwebtoken@9's own source), so this isn't closing an
// exploitable gap today. Pinned explicitly anyway, found during a security
// review: relying on a dependency's inference to keep doing the right thing
// forever is a fragile foundation for something this sensitive, and an
// explicit allow-list is the standard, recommended defense regardless
// (OWASP JWT Cheat Sheet — "explicitly allowlist accepted algorithms").
const JWT_ALGORITHM = "HS256";

/**
 * Fails fast at process startup on a non-numeric TTL, rather than silently
 * computing `NaN` and only surfacing as a confusing error the first time a
 * token is signed — a real bug caught in this file's own test suite (see
 * jwt-token.service.spec.ts). Deliberately does NOT reject a negative
 * value: a negative TTL is a real, intentional way to construct an
 * already-expired token for testing token-expiry rejection (see that same
 * spec file), not a misconfiguration to guard against.
 */
function parseTtlSecondsEnv(
  envVarName: string,
  rawValue: string | undefined,
  fallback: number,
): number {
  if (rawValue === undefined) {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${envVarName} must be a number of seconds, got "${rawValue}".`);
  }
  return parsed;
}

/**
 * Access and refresh tokens are signed with two DIFFERENT secrets
 * (JWT_ACCESS_SECRET / JWT_REFRESH_SECRET) — a leaked access-token signing
 * key (used far more often, on every request) must not be usable to forge
 * a long-lived refresh token, and vice versa.
 */
@Injectable()
export class JwtTokenService implements TokenService {
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;

  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(private readonly jwtService: JwtService) {
    const accessSecret = process.env["JWT_ACCESS_SECRET"];
    const refreshSecret = process.env["JWT_REFRESH_SECRET"];
    if (!accessSecret || !refreshSecret) {
      throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must both be set.");
    }
    this.accessSecret = accessSecret;
    this.refreshSecret = refreshSecret;
    this.accessTokenTtlSeconds = parseTtlSecondsEnv(
      "JWT_ACCESS_TTL_SECONDS",
      process.env["JWT_ACCESS_TTL_SECONDS"],
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    );
    this.refreshTokenTtlSeconds = parseTtlSecondsEnv(
      "JWT_REFRESH_TTL_SECONDS",
      process.env["JWT_REFRESH_TTL_SECONDS"],
      DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
    );
  }

  issueAccessToken(payload: AccessTokenPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessTokenTtlSeconds,
      algorithm: JWT_ALGORITHM,
    });
  }

  issueRefreshToken(payload: RefreshTokenPayload): string {
    return this.jwtService.sign(payload, {
      secret: this.refreshSecret,
      expiresIn: this.refreshTokenTtlSeconds,
      algorithm: JWT_ALGORITHM,
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return this.jwtService.verify<AccessTokenPayload>(token, {
        secret: this.accessSecret,
        algorithms: [JWT_ALGORITHM],
      });
    } catch {
      throw new InvalidAccessTokenError();
    }
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return this.jwtService.verify<RefreshTokenPayload>(token, {
        secret: this.refreshSecret,
        algorithms: [JWT_ALGORITHM],
      });
    } catch {
      throw new InvalidRefreshTokenError();
    }
  }

  static generateJti(): string {
    return randomUUID();
  }
}
