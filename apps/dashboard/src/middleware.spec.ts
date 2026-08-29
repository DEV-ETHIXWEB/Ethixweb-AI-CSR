import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const SESSION_COOKIE = "ethixweb_session";

/**
 * Regression coverage for a real production crash: an access token aging
 * past its TTL during ordinary browsing hit "Cookies can only be modified
 * in a Server Action or Route Handler" the moment a Server Component tried
 * to persist a refreshed session. The fix moved proactive refresh here,
 * the one place in the App Router allowed to both read and write the
 * session cookie mid-request. These tests exercise that logic directly
 * against a real NextRequest/NextResponse pair with a mocked fetch for
 * core-api's own /auth/refresh call, so a future edit to this file can't
 * silently reintroduce the crash or the single-use-refresh-token loss bug
 * that a naive "just don't crash" fix would have caused instead.
 */
function jwtWithExp(expSecondsFromNow: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "u1", exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

function sessionCookieValue(overrides: Partial<Record<string, string>> = {}): string {
  return JSON.stringify({
    accessToken: jwtWithExp(900),
    refreshToken: "refresh-token-1",
    userId: "u1",
    tenantId: "tenant-1",
    role: "owner",
    email: "owner@example.com",
    ...overrides,
  });
}

function requestWithCookie(pathname: string, cookieValue?: string): NextRequest {
  const url = `http://localhost:3001${pathname}`;
  const headers = new Headers();
  if (cookieValue) {
    headers.set("cookie", `${SESSION_COOKIE}=${encodeURIComponent(cookieValue)}`);
  }
  return new NextRequest(url, { headers });
}

describe("dashboard middleware", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env["CORE_API_BASE_URL"] = "http://core-api.invalid";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("redirects to /login with no session cookie on a protected path", async () => {
    const res = await middleware(requestWithCookie("/admin/overview"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("passes a fresh-enough access token through untouched, with no refresh call and no Set-Cookie", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const res = await middleware(
      requestWithCookie("/admin/overview", sessionCookieValue({ accessToken: jwtWithExp(900) })),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.status).not.toBe(307);
  });

  it("proactively refreshes and persists a new session cookie when the access token is near expiry, using the request's real refresh token", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: "new-access", refreshToken: "new-refresh" }), {
        status: 200,
      }),
    );
    global.fetch = fetchSpy;

    const res = await middleware(
      requestWithCookie(
        "/admin/overview",
        sessionCookieValue({ accessToken: jwtWithExp(10), refreshToken: "refresh-token-1" }),
      ),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://core-api.invalid/v1/auth/refresh",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: "refresh-token-1" });

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(SESSION_COOKIE);
    const cookieValue = decodeURIComponent(setCookie!.split(";")[0]!.split("=").slice(1).join("="));
    const persisted = JSON.parse(cookieValue) as { accessToken: string; refreshToken: string };
    expect(persisted.accessToken).toBe("new-access");
    expect(persisted.refreshToken).toBe("new-refresh");
    expect(res.status).not.toBe(307);
  });

  it("redirects to /login and clears the cookie when core-api explicitly rejects the refresh token", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: "invalid" }), { status: 401 }));
    global.fetch = fetchSpy;

    const res = await middleware(
      requestWithCookie("/admin/overview", sessionCookieValue({ accessToken: jwtWithExp(10) })),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE}=;`);
  });

  it("does NOT force a sign-out when core-api is merely unreachable, a transient network error is not the same as a rejected session", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("fetch failed"));
    global.fetch = fetchSpy;

    const res = await middleware(
      requestWithCookie("/admin/overview", sessionCookieValue({ accessToken: jwtWithExp(10) })),
    );

    expect(res.status).not.toBe(307);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("redirects an already-authenticated visitor away from /login", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const res = await middleware(requestWithCookie("/login", sessionCookieValue()));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/overview");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats an unparseable session cookie the same as no session", async () => {
    const res = await middleware(requestWithCookie("/admin/overview", "not-json"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
