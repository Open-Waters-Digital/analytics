import { describe, expect, it, vi } from "vitest";
import { resolveSession, type AppSession } from "./session-policy";

const allowlist = new Set(["alex@openwaters.digital"]);
const session: AppSession = { user: { id: "u1", email: "alex@openwaters.digital" } };

describe("resolveSession", () => {
  it("returns null when there is no session", async () => {
    await expect(resolveSession(async () => null, allowlist)).resolves.toBeNull();
  });

  it("returns a valid session for an allowlisted user", async () => {
    await expect(resolveSession(async () => session, allowlist)).resolves.toBe(session);
  });

  it("rejects a session whose address has been removed from the allowlist", async () => {
    await expect(
      resolveSession(async () => session, new Set(["other@openwaters.digital"])),
    ).resolves.toBeNull();
  });

  it("treats a failure while loading the session as signed out, without leaking detail", async () => {
    const log = { error: vi.fn() };
    const result = await resolveSession(
      async () => {
        throw new Error("connect ECONNREFUSED postgres://user:secret@db");
      },
      allowlist,
      log,
    );
    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledOnce();
    expect(String(log.error.mock.calls[0]![0])).not.toContain("secret");
  });
});
