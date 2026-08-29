import { NextResponse, type NextRequest } from "next/server";
import { coreApiUrl } from "@/lib/core-api-url";
import type { SessionData } from "@/lib/session";

const SESSION_COOKIE = "ethixweb_session";
const PUBLIC_PATHS = ["/login"];
// Refresh proactively once the access token is within this many seconds of
// expiring, not only once it has already expired, so a request that lands
// right at the boundary still gets a token that's valid for the rest of
// its own round trip through core-api.
const REFRESH_BUFFER_SECONDS = 60;

/**
 * Edge middleware is the only place in the App Router allowed to both READ
 * and WRITE the session cookie mid-request. A Server Component's own data
 * fetch (coreApiFetch, src/lib/core-api-client.ts) can hit a 401 and learn
 * the access token expired, but it can never persist a refreshed one:
 * Next.js hard-restricts cookie writes to Server Actions/Route
 * Handlers/Middleware, and a plain page render is none of those. Found
 * live: an expired access token during ordinary browsing crashed the page
 * with "Cookies can only be modified in a Server Action or Route Handler."
 *
 * Refreshing here, before the request ever reaches a Server Component,
 * closes that gap for the common case (an access token aging past its
 * ~15-minute TTL during a normal browsing session). By the time a page
 * renders, the token has already been rotated if it needed to be.
 * core-api-client.ts's own reactive 401-triggered refresh stays in place
 * as a fallback for the rarer case this proactive check misses (e.g. a
 * token revoked server-side for an unrelated reason), now with its own
 * cookie-write wrapped so THAT path degrades instead of crashing too.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const rawSession = request.cookies.get(SESSION_COOKIE)?.value;
  let session = parseSession(rawSession);

  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  let refreshedSession: SessionData | null = null;
  if (session) {
    const exp = decodeAccessTokenExp(session.accessToken);
    const nowSeconds = Date.now() / 1000;
    if (exp !== null && exp - nowSeconds < REFRESH_BUFFER_SECONDS) {
      const result = await refreshSession(session);
      if (result.outcome === "refreshed") {
        refreshedSession = result.session;
      } else if (result.outcome === "rejected") {
        // core-api's refresh endpoint rejected the refresh token (expired,
        // already rotated, or revoked), so this session is genuinely over,
        // not a transient hiccup worth retrying on the next request.
        session = null;
      }
      // result.outcome === "unreachable": leave the existing (soon-to-
      // expire) session as-is rather than forcing a sign-out over a
      // transient network error. The reactive refresh in coreApiFetch
      // gets another chance on the actual data fetch that follows.
    }
  }

  const activeSession = refreshedSession ?? session;

  if (!activeSession && !isPublic && pathname !== "/") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  if (activeSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/admin/overview", request.url));
  }

  if (refreshedSession) {
    // Updates the request's own cookie jar too (not just the response's)
    // so a Server Component rendering later in THIS SAME request reads the
    // fresh token via next/headers's cookies() rather than the stale one
    // that was on the incoming request. This is the documented Next.js
    // pattern for a middleware-side token refresh that downstream RSC code
    // can see immediately, not just on the browser's next request.
    request.cookies.set(SESSION_COOKIE, JSON.stringify(refreshedSession));
    const response = NextResponse.next({ request });
    setSessionCookie(response, refreshedSession);
    return response;
  }

  return NextResponse.next();
}

function parseSession(raw: string | undefined): SessionData | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

function decodeAccessTokenExp(accessToken: string): number | null {
  const payloadSegment = accessToken.split(".")[1];
  if (!payloadSegment) {
    return null;
  }
  try {
    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

type RefreshResult =
  | { outcome: "refreshed"; session: SessionData }
  | { outcome: "rejected" }
  | { outcome: "unreachable" };

async function refreshSession(session: SessionData): Promise<RefreshResult> {
  let res: Response;
  try {
    res = await fetch(coreApiUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
      cache: "no-store",
    });
  } catch {
    return { outcome: "unreachable" };
  }
  if (!res.ok) {
    return { outcome: "rejected" };
  }
  const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
  return {
    outcome: "refreshed",
    session: { ...session, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
  };
}

function setSessionCookie(response: NextResponse, session: SessionData): void {
  response.cookies.set(SESSION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Matches the refresh token's own server-side lifetime
    // (JWT_REFRESH_TTL_SECONDS, default 30 days).
    maxAge: 60 * 60 * 24 * 30,
  });
}

export const config = {
  // Excludes static assets under public/ (e.g. ethixweb-wordmark.png, used on
  // the login page itself) in addition to the framework internals already
  // excluded: an unauthenticated request for a plain image file must never
  // be redirected to an HTML login page, or the login page's own logo (and
  // any future public/ asset) silently breaks for a signed-out visitor.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|gif)$).*)",
  ],
};
