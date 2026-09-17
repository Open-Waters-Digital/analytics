import { afterEach, describe, expect, it, vi } from "vitest";

describe("db client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // `next build` imports route modules. If importing the client needed a
  // database URL, the build would need one too, and on Railway the build runs
  // before migrations and without the private network.
  it("can be imported without DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    await expect(import("./client")).resolves.toHaveProperty("getDb");
  });

  it("fails on first use, naming the missing variable", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    const { getDb } = await import("./client");
    expect(() => getDb()).toThrow(/DATABASE_URL/);
  });
});
