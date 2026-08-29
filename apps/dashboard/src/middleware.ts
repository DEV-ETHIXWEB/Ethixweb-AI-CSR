import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "ethixweb_session";
const PUBLIC_PATHS = ["/login"];

/**
 * Edge middleware only checks for the session cookie's PRESENCE, it
 * cannot safely parse/validate the JWTs inside it here (no core-api round
 * trip from the edge, and no reason to duplicate core-api's own token
 * validation). Every actual authenticated data fetch still goes through
 * coreApiFetch (src/lib/core-api-client.ts), which is the real
 * authentication boundary and handles token expiry/refresh/401 for real.
 * This middleware exists purely to keep an unauthenticated browser from
 * ever rendering the /admin shell at all.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!hasSession && !isPublic && pathname !== "/") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/admin/overview", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Excludes static assets under public/ (e.g. ethixweb-emblem.png, used on
  // the login page itself) in addition to the framework internals already
  // excluded: an unauthenticated request for a plain image file must never
  // be redirected to an HTML login page, or the login page's own logo (and
  // any future public/ asset) silently breaks for a signed-out visitor.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|gif)$).*)",
  ],
};
