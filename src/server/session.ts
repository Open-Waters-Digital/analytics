import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { safeReturnTo } from "./access";
import { getAuth } from "./auth";
import { env } from "./env";
import { resolveSession, UnauthorisedError, type AppSession } from "./session-policy";

export { UnauthorisedError, type AppSession };

/** Request header set by proxy.ts so server components know the requested path. */
export const REQUEST_PATH_HEADER = "x-analytics-path";

/**
 * The session for this request, or null. Memoised per request, so a layout and
 * the page inside it share one lookup. Never throws: failures count as signed
 * out.
 */
export const getSession = cache(async (): Promise<AppSession | null> => {
  const requestHeaders = await headers();
  return resolveSession(
    async () => getAuth().api.getSession({ headers: requestHeaders }),
    env().AUTH_ALLOWED_EMAILS,
  );
});

/**
 * The gate for every data read and write in src/server. Call it first; it
 * throws UnauthorisedError when there is no valid session.
 */
export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) throw new UnauthorisedError();
  return session;
}

/** For server components: sends signed-out visitors to sign in, then back here. */
export async function requirePageSession(): Promise<AppSession> {
  const session = await getSession();
  if (session) return session;

  const requested = safeReturnTo((await headers()).get(REQUEST_PATH_HEADER));
  redirect(requested === "/" ? "/sign-in" : `/sign-in?returnTo=${encodeURIComponent(requested)}`);
}
