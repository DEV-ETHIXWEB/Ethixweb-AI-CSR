import { NextResponse } from "next/server";
import { coreApiUrl } from "@/lib/core-api-url";
import { clearSession, getSession } from "@/lib/session";

/**
 * Proxies to core-api's real POST /v1/auth/logout, which revokes the
 * refresh token's jti server-side (Redis-backed, confirmed by audit,
 * this is real revocation, not merely discarding the client's copy). The
 * access token itself is not revoked (stateless JWT, expires within its
 * own 15-minute TTL), matching core-api's own documented logout
 * semantics exactly, not inventing a stronger guarantee than the backend
 * actually provides.
 */
export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  if (session) {
    await fetch(coreApiUrl("/auth/logout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
      cache: "no-store",
      // Node's fetch has no default timeout: without this, a hung (not
      // erroring) core-api would leave this whole request, and the "best
      // effort" intent right below, waiting indefinitely, exactly the
      // outcome that comment already says this code doesn't want.
      signal: AbortSignal.timeout(8000),
    }).catch(() => {
      // Best-effort: even if core-api is unreachable (or the timeout
      // above fires), clear the local session below so the user is not
      // stuck "logged in" client-side against a backend they can no
      // longer reach.
    });
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}
