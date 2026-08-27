import { NextResponse } from "next/server";
import { coreApiUrl } from "@/lib/core-api-url";
import { setSession } from "@/lib/session";

interface LoginRequestBody {
  tenantId: string;
  email: string;
  password: string;
}

interface CoreApiTokenResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    tenantId: string;
    email: string;
    role: "owner" | "admin" | "dispatcher" | "viewer";
  };
}

/**
 * Proxies to core-api's real POST /v1/auth/login. Login is (tenantId,
 * email, password) — NOT email/password alone — matching core-api's own
 * deliberate design (no cross-tenant email lookup path exists; see
 * apps/core-api/src/modules/auth/application/commands/login.use-case.ts's
 * own comment). This app's login form collects tenantId explicitly rather
 * than inventing a tenant-resolution step core-api doesn't support.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as LoginRequestBody;

  let res: Response;
  try {
    res = await fetch(coreApiUrl("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    // core-api unreachable (network error, not an HTTP error response) —
    // caught explicitly so an outage surfaces as a normal, user-facing
    // sign-in failure rather than an uncaught exception that Next.js
    // turns into a raw 500 with no actionable message. Found by directly
    // testing this route against a stopped core-api during this phase's
    // own verification, not assumed.
    return NextResponse.json(
      { message: "Unable to reach the server. Please try again shortly." },
      { status: 503 },
    );
  }

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as {
      message?: string;
      statusCode?: number;
    } | null;
    return NextResponse.json(
      { message: errorBody?.message ?? "Sign-in failed." },
      { status: res.status },
    );
  }

  const tokens = (await res.json()) as CoreApiTokenResponse;
  await setSession({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    userId: tokens.user.id,
    tenantId: tokens.user.tenantId,
    role: tokens.user.role,
    email: tokens.user.email,
  });

  return NextResponse.json({ ok: true });
}
