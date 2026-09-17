import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("accepts a postgres URL and defaults NODE_ENV", () => {
    const parsed = parseEnv({ DATABASE_URL: "postgres://user:pass@localhost:5432/analytics" });
    expect(parsed.DATABASE_URL).toContain("localhost");
    expect(parsed.NODE_ENV).toBe("development");
  });

  it("rejects a missing DATABASE_URL, naming the variable", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "mysql://localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("never echoes a value in the error", () => {
    let message = "";
    try {
      parseEnv({ DATABASE_URL: "not-a-url-secret-value" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain("secret-value");
  });
});
