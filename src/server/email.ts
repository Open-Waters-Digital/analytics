import { Resend } from "resend";
import { BRAND_INK, BRAND_INK_MUTED } from "@/lib/brand-constants";
import { EmailSendError, EmailTimeoutError } from "./magic-link";

export const EMAIL_TIMEOUT_MS = 10_000;

interface EmailClient {
  emails: {
    send(message: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    }): Promise<{ error: { name?: string } | null }>;
  };
}

/**
 * Builds the function that emails a sign-in link through Resend. Rejects with
 * EmailTimeoutError after 10 seconds so a slow provider cannot hang the request,
 * and with EmailSendError when Resend reports a failure.
 */
export function createLinkSender(
  options: { apiKey: string; from: string },
  client: EmailClient = new Resend(options.apiKey),
  timeoutMs = EMAIL_TIMEOUT_MS,
): (to: string, url: string) => Promise<void> {
  return async (to, url) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EmailTimeoutError("email send timed out")), timeoutMs);
    });

    try {
      const result = await Promise.race([
        client.emails.send({
          from: options.from,
          to,
          subject: "Sign in to Open Waters Analytics",
          text: signInText(url),
          html: signInHtml(url),
        }),
        timeout,
      ]);
      if (result.error) throw new EmailSendError(result.error.name ?? "resend_error");
    } finally {
      clearTimeout(timer);
    }
  };
}

function signInText(url: string): string {
  return [
    "Use this link to sign in to Open Waters Analytics:",
    "",
    url,
    "",
    "It works once and expires in 15 minutes. If you did not ask to sign in, ignore this email.",
  ].join("\n");
}

function signInHtml(url: string): string {
  const safeUrl = escapeHtml(url);
  // Email clients ignore stylesheets, so styling is inline, with colours from
  // brand-constants.ts because emails cannot read CSS variables.
  return `<!doctype html>
<html lang="en-GB">
  <body style="font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: ${BRAND_INK}; line-height: 1.5;">
    <p>Use this link to sign in to Open Waters Analytics:</p>
    <p><a href="${safeUrl}" style="color: ${BRAND_INK}; font-weight: 600;">Sign in</a></p>
    <p style="color: ${BRAND_INK_MUTED};">It works once and expires in 15 minutes. If you did not ask to sign in, ignore this email.</p>
  </body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
