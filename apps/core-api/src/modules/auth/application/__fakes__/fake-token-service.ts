import { randomUUID } from "node:crypto";
import { InvalidAccessTokenError, InvalidRefreshTokenError } from "../../domain/errors";
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
  TokenService,
} from "../../domain/ports/token-service.port";

/**
 * Deterministic, non-cryptographic fake — application-layer tests exercise
 * orchestration logic (does the use-case call the right methods, handle
 * errors correctly), not JWT internals. Real signing/verification is
 * covered separately, against the real JwtTokenService implementation
 * (infrastructure/jwt-token.service.spec.ts).
 */
export class FakeTokenService implements TokenService {
  readonly accessTokenTtlSeconds = 900;
  readonly refreshTokenTtlSeconds = 2_592_000;

  private readonly issuedAccessTokens = new Map<string, AccessTokenPayload>();
  private readonly issuedRefreshTokens = new Map<string, RefreshTokenPayload>();

  issueAccessToken(payload: AccessTokenPayload): string {
    const token = `access:${randomUUID()}`;
    this.issuedAccessTokens.set(token, payload);
    return token;
  }

  issueRefreshToken(payload: RefreshTokenPayload): string {
    const token = `refresh:${randomUUID()}`;
    this.issuedRefreshTokens.set(token, payload);
    return token;
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = this.issuedAccessTokens.get(token);
    if (!payload) {
      throw new InvalidAccessTokenError();
    }
    return payload;
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    const payload = this.issuedRefreshTokens.get(token);
    if (!payload) {
      throw new InvalidRefreshTokenError();
    }
    return payload;
  }
}
