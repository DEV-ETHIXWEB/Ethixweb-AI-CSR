import { cookies } from "next/headers";

/**
 * core-api's auth (apps/core-api/src/modules/auth) returns access/refresh
 * JWTs in the response BODY only — there is no cookie support anywhere in
 * that service (confirmed by direct audit: no @fastify/cookie registration,
 * no Set-Cookie anywhere in the auth module) and no CORS configuration
 * exists for a separate-origin browser client to call it directly and
 * safely store the result.
 *
 * Rather than storing the raw access/refresh JWTs in localStorage
 * (readable by any injected script — a real XSS blast-radius difference)
 * or requiring a backend change to add cookie support, this app's own
 * Next.js Route Handlers (src/app/api/auth/*) act as a thin, same-origin
 * proxy: the browser only ever talks to THIS app's own origin, and THIS
 * app holds the actual core-api tokens in an httpOnly, sameSite=lax
 * session cookie the browser JS can never read. The proxy still makes a
 * real server-to-server fetch to core-api using the real login/refresh
 * endpoints — nothing about core-api's own auth contract changes.
 */
const SESSION_COOKIE = "ethixweb_session";

export interface SessionData {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
  role: "owner" | "admin" | "dispatcher" | "viewer";
  email: string;
}

export async function getSession(): Promise<SessionData | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function setSession(session: SessionData): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Matches the refresh token's own server-side lifetime
    // (JWT_REFRESH_TTL_SECONDS, default 30 days) — the session cookie
    // should not outlive the credential it carries.
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
