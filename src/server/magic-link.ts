import { isAllowed } from "./access";

export type DeliveryOutcome = "sent" | "printed" | "skipped" | "failed";

export interface DeliveryDeps {
  allowlist: ReadonlySet<string>;
  nodeEnv: "development" | "test" | "production";
  /** Present when a Resend key is configured. Throws on failure or timeout. */
  send: ((to: string, url: string) => Promise<void>) | undefined;
  log: Pick<Console, "info" | "error">;
}

/**
 * Decides what happens to a sign-in link. The caller always answers the
 * browser the same way, whatever the outcome, so the sign-in form never reveals
 * whether an address has access.
 *
 * Logs never contain the address or the link, except the deliberate
 * development-only fallback, which `env()` makes unreachable in production by
 * requiring RESEND_API_KEY there.
 */
export async function deliverMagicLink(
  { email, url }: { email: string; url: string },
  deps: DeliveryDeps,
): Promise<DeliveryOutcome> {
  if (!isAllowed(email, deps.allowlist)) {
    deps.log.info("auth: magic link not sent (address not allowlisted)");
    return "skipped";
  }

  if (!deps.send) {
    if (deps.nodeEnv === "production") {
      deps.log.error("auth: magic link not sent (no email sender configured)");
      return "failed";
    }
    deps.log.info(`auth: development sign-in link (no RESEND_API_KEY set): ${url}`);
    return "printed";
  }

  try {
    await deps.send(email, url);
    deps.log.info("auth: magic link sent");
    return "sent";
  } catch (error) {
    // "403" from Resend usually means AUTH_EMAIL_FROM is not on a verified domain.
    deps.log.error(`auth: magic link send failed (${describeError(error)})`);
    return "failed";
  }
}

/** A short, secret-free description: an error name or code, never a message. */
function describeError(error: unknown): string {
  if (error instanceof EmailTimeoutError) return "timeout";
  if (error instanceof EmailSendError) return error.code;
  if (error instanceof Error) return error.name;
  return "unknown";
}

export class EmailTimeoutError extends Error {
  override name = "EmailTimeoutError";
}

export class EmailSendError extends Error {
  override name = "EmailSendError";
  constructor(readonly code: string) {
    super(`email send failed: ${code}`);
  }
}
