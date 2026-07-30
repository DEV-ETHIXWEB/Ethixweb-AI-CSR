import { JwtService } from "@nestjs/jwt";
import { InvalidAccessTokenError, InvalidRefreshTokenError } from "../domain/errors";
import { JwtTokenService } from "./jwt-token.service";

const ORIGINAL_ENV = { ...process.env };

function buildService(overrides: Record<string, string | undefined> = {}): JwtTokenService {
  process.env["JWT_ACCESS_SECRET"] = overrides["JWT_ACCESS_SECRET"] ?? "test-access-secret";
  process.env["JWT_REFRESH_SECRET"] = overrides["JWT_REFRESH_SECRET"] ?? "test-refresh-secret";
  // Deliberately deleted, not assigned `undefined` — `process.env.X = undefined`
  // coerces to the STRING "undefined" in Node, which then survives the
  // constructor's `?? DEFAULT` fallback (a truthy string) and reaches
  // `Number("undefined")` as NaN. A real bug this test caught in itself,
  // not in JwtTokenService.
  setOrDeleteEnv("JWT_ACCESS_TTL_SECONDS", overrides["JWT_ACCESS_TTL_SECONDS"]);
  setOrDeleteEnv("JWT_REFRESH_TTL_SECONDS", overrides["JWT_REFRESH_TTL_SECONDS"]);
  return new JwtTokenService(new JwtService());
}

function setOrDeleteEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("JwtTokenService", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("issues and verifies a real, signed access token round-trip", () => {
    const service = buildService();
    const token = service.issueAccessToken({ sub: "user-1", tenantId: "tenant-1", role: "owner" });

    const payload = service.verifyAccessToken(token);

    expect(payload.sub).toBe("user-1");
    expect(payload.tenantId).toBe("tenant-1");
    expect(payload.role).toBe("owner");
  });

  it("issues and verifies a real, signed refresh token round-trip", () => {
    const service = buildService();
    const token = service.issueRefreshToken({ sub: "user-1", jti: "jti-1", tenantId: "tenant-1" });

    const payload = service.verifyRefreshToken(token);

    // toMatchObject, not toEqual: the library adds standard `iat`/`exp`
    // claims on top of the fields we issued (see this port's own comment
    // on why the type declares them as optional) — those are expected,
    // real, and not something this test should assert an exact value for.
    expect(payload).toMatchObject({ sub: "user-1", jti: "jti-1", tenantId: "tenant-1" });
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
  });

  it("rejects a tampered access token", () => {
    const service = buildService();
    const token = service.issueAccessToken({ sub: "user-1", tenantId: "tenant-1", role: "owner" });
    const tampered = `${token.slice(0, -2)}xx`;

    expect(() => service.verifyAccessToken(tampered)).toThrow(InvalidAccessTokenError);
  });

  it("rejects an access token verified with the wrong secret (simulating a leaked-refresh-secret scenario)", () => {
    const service = buildService();
    const accessToken = service.issueAccessToken({
      sub: "user-1",
      tenantId: "tenant-1",
      role: "owner",
    });

    // An access token must NOT verify as a refresh token, even though both
    // are just JWTs — proves the two secrets are genuinely independent.
    expect(() => service.verifyRefreshToken(accessToken)).toThrow(InvalidRefreshTokenError);
  });

  it("rejects an already-expired access token", () => {
    const service = buildService({ JWT_ACCESS_TTL_SECONDS: "-1" });
    const token = service.issueAccessToken({ sub: "user-1", tenantId: "tenant-1", role: "owner" });

    expect(() => service.verifyAccessToken(token)).toThrow(InvalidAccessTokenError);
  });

  it("generateJti produces a different value on every call", () => {
    const a = JwtTokenService.generateJti();
    const b = JwtTokenService.generateJti();
    expect(a).not.toBe(b);
  });

  it("throws at construction time if either secret is missing", () => {
    delete process.env["JWT_ACCESS_SECRET"];
    process.env["JWT_REFRESH_SECRET"] = "test-refresh-secret";
    expect(() => new JwtTokenService(new JwtService())).toThrow(
      "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must both be set.",
    );
  });

  it("throws at construction time on a non-numeric TTL, instead of silently computing NaN", () => {
    expect(() => buildService({ JWT_ACCESS_TTL_SECONDS: "not-a-number" })).toThrow(
      'JWT_ACCESS_TTL_SECONDS must be a number of seconds, got "not-a-number".',
    );
  });

  it("still accepts a negative TTL (used intentionally to construct an already-expired token, see above)", () => {
    expect(() => buildService({ JWT_ACCESS_TTL_SECONDS: "-1" })).not.toThrow();
  });

  it("rejects a refresh token that was signed with a different algorithm than the pinned allow-list expects", () => {
    const service = buildService();
    // A token whose header claims `alg: "none"` and carries no signature —
    // exactly the forged-token shape a missing algorithm allow-list would
    // be exploitable through. jsonwebtoken@9 already rejects this by
    // default for a string secret (verified against its own source before
    // relying on it), and the explicit `algorithms: ["HS256"]` pin added
    // as defense-in-depth must reject it too.
    const forgedHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: "user-1", jti: "jti-1", tenantId: "tenant-1" }),
    ).toString("base64url");
    const forgedToken = `${forgedHeader}.${forgedPayload}.`;

    expect(() => service.verifyRefreshToken(forgedToken)).toThrow(InvalidRefreshTokenError);
  });
});
