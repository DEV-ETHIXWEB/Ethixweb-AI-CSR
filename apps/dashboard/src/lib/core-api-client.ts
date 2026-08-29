import { coreApiUrl } from "./core-api-url";
import { getSession, setSession, clearSession, type SessionData } from "./session";

export class UnauthenticatedError extends Error {
  constructor() {
    super("No active session, the caller must sign in again.");
    this.name = "UnauthenticatedError";
  }
}

export class CoreApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`core-api request failed: ${status}`);
    this.name = "CoreApiError";
  }
}

/**
 * Server-side-only authenticated fetch against core-api. Used from Server
 * Components and Route Handlers, never shipped to the browser bundle
 * (nothing in this file touches document/window, and every call site is
 * itself server-only, so Next.js's server/client boundary keeps this out
 * of client JS by construction, not by convention alone).
 *
 * Retries exactly once on a 401 by rotating the refresh token (core-api's
 * refresh endpoint is itself single-use/rotating, confirmed by audit, so
 * a second 401 after that retry is treated as a genuinely expired
 * session, not retried further).
 */
export async function coreApiFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const session = await getSession();
  if (!session) {
    throw new UnauthenticatedError();
  }

  const attempt = async (accessToken: string) =>
    fetch(coreApiUrl(path), {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store" as const,
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });

  let res = await attempt(session.accessToken);

  if (res.status === 401) {
    const refreshed = await tryRefresh(session);
    if (!refreshed) {
      await clearSessionCookieIfPossible();
      throw new UnauthenticatedError();
    }
    res = await attempt(refreshed.accessToken);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new CoreApiError(res.status, body);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/**
 * The common case (an access token aging past its TTL during ordinary
 * browsing) is now handled proactively in middleware.ts, which refreshes
 * and persists the new session cookie BEFORE a Server Component ever
 * renders, the only place in the App Router allowed to do both. This is
 * the fallback for what that proactive check can miss (clock skew, a
 * token revoked server-side for an unrelated reason): still attempts the
 * refresh and still uses the new token for THIS request's retry, but
 * setSession's cookie write is wrapped below since a Server Component's
 * own render is NOT a context Next.js allows a cookie write from. Found
 * live, not hypothetical, as a hard "Cookies can only be modified in a
 * Server Action or Route Handler" crash. Losing the persist here (rather
 * than the whole page) is the acceptable degradation: the request in
 * flight still succeeds, and worst case the browser's stale cookie
 * repeats this same fallback once more before core-api's refresh-token
 * rotation eventually forces a real re-login.
 */
async function tryRefresh(session: SessionData): Promise<SessionData | null> {
  const res = await fetch(coreApiUrl("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
    cache: "no-store",
  });
  if (!res.ok) {
    return null;
  }
  const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
  const updated: SessionData = {
    ...session,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
  try {
    await setSession(updated);
  } catch {
    // Called from a Server Component render, not a Server Action/Route
    // Handler, which is expected in the fallback path this function exists
    // for (see the function's own comment). Proceed with the refreshed
    // token for this request regardless.
  }
  return updated;
}

async function clearSessionCookieIfPossible(): Promise<void> {
  try {
    await clearSession();
  } catch {
    // Same Server-Component-render restriction as tryRefresh's own
    // setSession call. The UnauthenticatedError this function's one
    // caller throws right after is what actually matters here.
  }
}
