/**
 * Paths that must work without a session. Everything else is protected. The
 * proxy matcher excludes these too; this list is the tested source of truth.
 */
const PUBLIC_PREFIXES = ["/sign-in", "/api/auth/", "/api/health"] as const;
const PUBLIC_FILES = new Set(["/favicon.ico", "/robots.txt"]);

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_FILES.has(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  return PUBLIC_PREFIXES.some(prefix =>
    prefix.endsWith("/")
      ? pathname.startsWith(prefix)
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export type ProxyDecision = { kind: "continue" } | { kind: "redirect"; location: string };

/**
 * An optimistic check only: no session cookie means a redirect to sign in, to
 * save rendering a page the visitor cannot see. A cookie is NOT proof of a
 * session. The data access layer (src/server/session.ts) makes the real decision.
 */
export function decide(pathname: string, search: string, hasSessionCookie: boolean): ProxyDecision {
  if (isPublicPath(pathname) || hasSessionCookie) return { kind: "continue" };
  const returnTo = `${pathname}${search}`;
  return {
    kind: "redirect",
    location: returnTo === "/" ? "/sign-in" : `/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
  };
}
