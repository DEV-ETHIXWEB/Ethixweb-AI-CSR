import { coreApiUrl } from "./core-api-url";
import { getSession, setSession, clearSession, type SessionData } from "./session";

export class UnauthenticatedError extends Error {
  constructor() {
    super("No active session — the caller must sign in again.");
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
 * Components and Route Handlers — never shipped to the browser bundle
 * (nothing in this file touches document/window, and every call site is
 * itself server-only, so Next.js's server/client boundary keeps this out
 * of client JS by construction, not by convention alone).
 *
 * Retries exactly once on a 401 by rotating the refresh token (core-api's
 * refresh endpoint is itself single-use/rotating — confirmed by audit —
 * so a second 401 after that retry is treated as a genuinely expired
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
      await clearSession();
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
  await setSession(updated);
  return updated;
}
