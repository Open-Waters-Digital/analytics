import { isAllowed } from "./access";

export interface SessionUser {
  id: string;
  email: string;
}

export interface AppSession {
  user: SessionUser;
}

export class UnauthorisedError extends Error {
  override name = "UnauthorisedError";
  constructor() {
    super("unauthorised");
  }
}

/**
 * The whole access decision, kept pure so every branch is tested: a session
 * grants access only if it could be loaded, and only while its email address is
 * still on the allowlist. Anything that goes wrong while loading counts as
 * signed out (fail closed).
 */
export async function resolveSession(
  load: () => Promise<AppSession | null>,
  allowlist: ReadonlySet<string>,
  log: Pick<Console, "error"> = console,
): Promise<AppSession | null> {
  let session: AppSession | null;
  try {
    session = await load();
  } catch (error) {
    log.error(`auth: session check failed, treating as signed out (${nameOf(error)})`);
    return null;
  }
  if (!session) return null;
  if (!isAllowed(session.user.email, allowlist)) return null;
  return session;
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
