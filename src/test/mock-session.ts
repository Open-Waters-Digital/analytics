import { UnauthorisedError, type AppSession } from "@/server/session-policy";

/**
 * Stand-in for @/server/session in integration tests, which run outside a
 * Next.js request. Use with:
 *
 *   vi.mock("@/server/session", () => import("@/test/mock-session"));
 *
 * and flip `testSession.signedIn` to exercise the signed-out path.
 */
export const testSession = { signedIn: true };

const session: AppSession = { user: { id: "test-user", email: "test@openwaters.digital" } };

export { UnauthorisedError };

export async function requireSession(): Promise<AppSession> {
  if (!testSession.signedIn) throw new UnauthorisedError();
  return session;
}

export async function getSession(): Promise<AppSession | null> {
  return testSession.signedIn ? session : null;
}
