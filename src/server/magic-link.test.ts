import { describe, expect, it, vi } from "vitest";
import {
  deliverMagicLink,
  EmailSendError,
  EmailTimeoutError,
  type DeliveryDeps,
} from "./magic-link";

const email = "alex@openwaters.digital";
const url = "https://analytics.openwaters.digital/api/auth/magic-link/verify?token=secret-token";

function deps(overrides: Partial<DeliveryDeps> = {}) {
  const log = { info: vi.fn(), error: vi.fn() };
  const send = vi.fn(async () => {});
  return {
    log,
    send,
    deps: {
      allowlist: new Set([email]),
      nodeEnv: "production" as const,
      send,
      log,
      ...overrides,
    },
  };
}

function allLogLines(log: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }) {
  return [...log.info.mock.calls, ...log.error.mock.calls].map(call => String(call[0]));
}

describe("deliverMagicLink", () => {
  it("sends to an allowlisted address", async () => {
    const { deps: d, send, log } = deps();
    await expect(deliverMagicLink({ email, url }, d)).resolves.toBe("sent");
    expect(send).toHaveBeenCalledWith(email, url);
    expect(log.info).toHaveBeenCalledWith("auth: magic link sent");
  });

  it("matches the allowlist regardless of case", async () => {
    const { deps: d, send } = deps();
    await expect(deliverMagicLink({ email: "Alex@OpenWaters.digital", url }, d)).resolves.toBe(
      "sent",
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it("skips an address that is not allowlisted, without sending", async () => {
    const { deps: d, send } = deps();
    await expect(deliverMagicLink({ email: "stranger@example.com", url }, d)).resolves.toBe(
      "skipped",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a Resend failure without throwing", async () => {
    const { deps: d, log } = deps({
      send: vi.fn(async () => {
        throw new EmailSendError("validation_error");
      }),
    });
    await expect(deliverMagicLink({ email, url }, d)).resolves.toBe("failed");
    expect(log.error).toHaveBeenCalledWith("auth: magic link send failed (validation_error)");
  });

  it("reports a timeout without throwing", async () => {
    const { deps: d, log } = deps({
      send: vi.fn(async () => {
        throw new EmailTimeoutError("email send timed out");
      }),
    });
    await expect(deliverMagicLink({ email, url }, d)).resolves.toBe("failed");
    expect(log.error).toHaveBeenCalledWith("auth: magic link send failed (timeout)");
  });

  it("never logs the address, the link or the token in production", async () => {
    for (const send of [
      vi.fn(async () => {}),
      vi.fn(async () => {
        throw new Error(`boom ${email} ${url}`);
      }),
    ]) {
      const { deps: d, log } = deps({ send });
      await deliverMagicLink({ email, url }, d);
      await deliverMagicLink({ email: "stranger@example.com", url }, d);
      for (const line of allLogLines(log)) {
        expect(line).not.toContain("openwaters.digital");
        expect(line).not.toContain("example.com");
        expect(line).not.toContain("secret-token");
      }
    }
  });

  describe("without an email sender", () => {
    it("prints the link in development", async () => {
      const { deps: d, log } = deps({ nodeEnv: "development", send: undefined });
      await expect(deliverMagicLink({ email, url }, d)).resolves.toBe("printed");
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining(url));
    });

    it("does not print for an address that is not allowlisted", async () => {
      const { deps: d, log } = deps({ nodeEnv: "development", send: undefined });
      await expect(deliverMagicLink({ email: "stranger@example.com", url }, d)).resolves.toBe(
        "skipped",
      );
      expect(allLogLines(log).join("\n")).not.toContain(url);
    });

    it("never prints the link in production", async () => {
      const { deps: d, log } = deps({ nodeEnv: "production", send: undefined });
      await expect(deliverMagicLink({ email, url }, d)).resolves.toBe("failed");
      expect(allLogLines(log).join("\n")).not.toContain(url);
    });
  });
});
