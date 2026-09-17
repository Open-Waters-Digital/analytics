import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { decide } from "@/lib/proxy-policy";

/** Keep in sync with REQUEST_PATH_HEADER in src/server/session.ts. */
const REQUEST_PATH_HEADER = "x-analytics-path";

/**
 * Optimistic redirect for signed-out visitors, and the requested path passed to
 * server components so they can send people back after signing in. This never
 * grants access; see src/lib/proxy-policy.ts.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = decide(pathname, search, Boolean(getSessionCookie(request)));

  if (decision.kind === "redirect") {
    return NextResponse.redirect(new URL(decision.location, request.url));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_PATH_HEADER, `${pathname}${search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Skip Next's own assets and the public files; proxy-policy.ts still treats
  // the sign-in and auth paths as public in case they reach it.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
