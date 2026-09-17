import "server-only";
import { z } from "zod";
import { normaliseEmail, safeReturnTo } from "./access";
import { getAuth } from "./auth";
import { env } from "./env";

export type SignInResult =
  { ok: true } | { ok: false; reason: "invalid_email" } | { ok: false; reason: "rate_limited" };

/** Where Better Auth sends people when a link is used, expired or tampered with. */
export const LINK_ERROR_PATH = "/sign-in?error=link";

const emailSchema = z.email();

/**
 * Requests a sign-in link. The request goes through Better Auth's HTTP handler
 * rather than `auth.api`, because the handler is where Better Auth applies its
 * rate limit; a direct API call would skip it. The visitor's IP headers are
 * passed along so the limit counts per visitor.
 *
 * Every outcome other than an invalid address or the rate limit reports success,
 * so the form never reveals whether an address has access.
 */
export async function requestMagicLink(
  input: { email: string; returnTo: string | null },
  incoming: Headers,
): Promise<SignInResult> {
  const email = normaliseEmail(input.email);
  if (!emailSchema.safeParse(email).success) return { ok: false, reason: "invalid_email" };

  const { BETTER_AUTH_URL } = env();
  const headers = new Headers({
    "content-type": "application/json",
    origin: new URL(BETTER_AUTH_URL).origin,
  });
  for (const name of ["x-real-ip", "x-forwarded-for"]) {
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }

  const response = await getAuth().handler(
    new Request(new URL("/api/auth/sign-in/magic-link", BETTER_AUTH_URL), {
      method: "POST",
      headers,
      body: JSON.stringify({
        email,
        callbackURL: safeReturnTo(input.returnTo),
        errorCallbackURL: LINK_ERROR_PATH,
      }),
    }),
  );

  if (response.status === 429) return { ok: false, reason: "rate_limited" };
  if (!response.ok) console.error(`auth: magic link request returned ${response.status}`);
  return { ok: true };
}
