/**
 * `iat`/`exp` are optional here deliberately: callers issuing a token never
 * supply them (the JWT library adds both automatically at signing time,
 * from `expiresIn`), but a *verified* payload always carries both — an
 * implementation returning exactly the fields declared here and nothing
 * more would be lying about what `jsonwebtoken`/`JwtService.verify()`
 * actually hands back. Declaring them as optional keeps the type honest at
 * both ends of the interface rather than requiring every caller to know
 * this JWT-specific detail themselves.
 */
export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  /**
   * Carried in the (signed, tamper-evident) refresh token itself, not just
   * the access token — without it, verifying a refresh token gives back a
   * bare userId with no way to resolve which tenant's RLS context to look
   * that user up under (docs/20 ADR-013/ADR-014). Safe to embed: a JWT's
   * signature makes every claim in it exactly as trustworthy as the
   * server's own signing key, the same reasoning that already justifies
   * `tenantId` on the access token payload.
   */
  tenantId: string;
  iat?: number;
  exp?: number;
}

/**
 * Abstracts JWT issuance/verification behind a port so the application
 * layer's login/refresh commands stay testable with a fake, and so a
 * future token format change (e.g. a different signing algorithm, or
 * migrating off JWTs entirely) is an infrastructure swap, not an
 * application-layer rewrite — the same reasoning as every other adapter
 * boundary in this codebase (docs/14-backend-stack-and-code-standards.md §2).
 * Verification methods throw the domain errors in ../errors.ts on failure
 * (InvalidAccessTokenError / InvalidRefreshTokenError) — callers never see
 * a raw JWT-library exception.
 */
export interface TokenService {
  issueAccessToken(payload: AccessTokenPayload): string;
  issueRefreshToken(payload: RefreshTokenPayload): string;
  verifyAccessToken(token: string): AccessTokenPayload;
  verifyRefreshToken(token: string): RefreshTokenPayload;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
}

export const TOKEN_SERVICE = Symbol("TOKEN_SERVICE");
