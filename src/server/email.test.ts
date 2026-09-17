import { describe, expect, it, vi } from "vitest";
import { createLinkSender, escapeHtml } from "./email";
import { EmailSendError, EmailTimeoutError } from "./magic-link";

const options = { apiKey: "re_test", from: "Open Waters Analytics <analytics@openwaters.digital>" };
const url =
  "https://analytics.openwaters.digital/api/auth/magic-link/verify?token=abc&callbackURL=%2F";

describe("createLinkSender", () => {
  it("sends a text and HTML email containing the link", async () => {
    type Message = { to: string; from: string; subject: string; text: string; html: string };
    const send = vi.fn(async (_message: Message) => ({ error: null }));
    await createLinkSender(options, { emails: { send } })("alex@openwaters.digital", url);

    expect(send).toHaveBeenCalledOnce();
    const message = send.mock.calls[0]![0];
    expect(message.to).toBe("alex@openwaters.digital");
    expect(message.from).toBe(options.from);
    expect(message.text).toContain(url);
    expect(message.html).toContain(escapeHtml(url));
    expect(message.text).toContain("15 minutes");
  });

  it("rejects with EmailSendError when Resend reports an error", async () => {
    const send = vi.fn(async () => ({ error: { name: "validation_error" } }));
    const sender = createLinkSender(options, { emails: { send } });
    await expect(sender("alex@openwaters.digital", url)).rejects.toEqual(
      new EmailSendError("validation_error"),
    );
  });

  it("keeps the status code when Resend sends no error name", async () => {
    // What Resend returned in production for a sender on an unverified domain.
    const send = vi.fn(async () => ({
      error: {
        statusCode: 403,
        message: "This API key is not authorized to send emails from openwaters.digital",
      },
    }));
    const sender = createLinkSender(options, { emails: { send } });
    await expect(sender("alex@openwaters.digital", url)).rejects.toEqual(new EmailSendError("403"));
  });

  it("rejects with EmailTimeoutError when Resend does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn(() => new Promise<{ error: null }>(() => {}));
      const promise = createLinkSender(
        options,
        { emails: { send } },
        10_000,
      )("alex@openwaters.digital", url);
      const assertion = expect(promise).rejects.toBeInstanceOf(EmailTimeoutError);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("escapeHtml", () => {
  it("escapes characters that could break out of an attribute", () => {
    expect(escapeHtml(`"><script>&'`)).toBe("&quot;&gt;&lt;script&gt;&amp;&#39;");
  });
});
