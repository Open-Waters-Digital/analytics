import { describe, expect, it } from "vitest";
import { parseDatabaseEnv, parseEnv } from "./env";

describe("parseDatabaseEnv", () => {
  // The pre-deploy migration must not fail because an unrelated secret is unset.
  it("needs only DATABASE_URL", () => {
    const url = "postgres://user:pass@localhost:5432/analytics";
    expect(parseDatabaseEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseDatabaseEnv({})).toThrow(/DATABASE_URL/);
  });
});

const valid = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/analytics",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  AUTH_EMAIL_FROM: "Open Waters Analytics <analytics@openwaters.digital>",
  AUTH_ALLOWED_EMAILS: "alex@openwaters.digital",
};

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

describe("parseEnv", () => {
  it("accepts a complete development config and defaults NODE_ENV", () => {
    const parsed = parseEnv(valid);
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.RESEND_API_KEY).toBeUndefined();
  });

  it("rejects a missing DATABASE_URL, naming the variable", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://localhost/db" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("never echoes a value in the error", () => {
    const message = messageOf(() =>
      parseEnv({ ...valid, DATABASE_URL: "not-a-url-secret-value", BETTER_AUTH_SECRET: "short" }),
    );
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/BETTER_AUTH_SECRET/);
    expect(message).not.toContain("secret-value");
    expect(message).not.toContain("short");
  });

  describe("AUTH_ALLOWED_EMAILS", () => {
    it("parses a comma-separated list into a lower-cased, trimmed set", () => {
      const parsed = parseEnv({
        ...valid,
        AUTH_ALLOWED_EMAILS: " Alex@OpenWaters.digital , partner@openwaters.digital,,",
      });
      expect([...parsed.AUTH_ALLOWED_EMAILS]).toEqual([
        "alex@openwaters.digital",
        "partner@openwaters.digital",
      ]);
    });

    it("rejects an empty list", () => {
      expect(() => parseEnv({ ...valid, AUTH_ALLOWED_EMAILS: " , " })).toThrow(
        /AUTH_ALLOWED_EMAILS/,
      );
    });

    it("rejects an entry that is not an email address", () => {
      expect(() =>
        parseEnv({ ...valid, AUTH_ALLOWED_EMAILS: "alex@openwaters.digital,alex" }),
      ).toThrow(/AUTH_ALLOWED_EMAILS/);
    });
  });

  it("requires a secret of at least 32 characters", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "a".repeat(31) })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  describe("production", () => {
    const production = {
      ...valid,
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://analytics.openwaters.digital",
      RESEND_API_KEY: "re_test",
    };

    it("accepts a complete production config", () => {
      expect(parseEnv(production).NODE_ENV).toBe("production");
    });

    it("requires RESEND_API_KEY, so the log fallback cannot run", () => {
      expect(() => parseEnv({ ...production, RESEND_API_KEY: undefined })).toThrow(
        /RESEND_API_KEY/,
      );
    });

    it("requires an https BETTER_AUTH_URL", () => {
      expect(() => parseEnv({ ...production, BETTER_AUTH_URL: "http://example.com" })).toThrow(
        /BETTER_AUTH_URL/,
      );
    });
  });
});
