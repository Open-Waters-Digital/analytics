import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey, lastFour } from "./crypto";
import { MissingConfigurationError, parseCredentialsKey } from "./env";

const masterKey = randomBytes(32);
const apiKey = "phx_ExampleQueryReadKey1234";

describe("encryptApiKey / decryptApiKey", () => {
  it("round trips for the same connection", () => {
    const id = randomUUID();
    const stored = encryptApiKey(apiKey, id, masterKey);
    expect(decryptApiKey(stored, id, masterKey)).toEqual({ ok: true, apiKey });
  });

  it("never stores the key in readable form", () => {
    const stored = encryptApiKey(apiKey, randomUUID(), masterKey);
    expect(stored).not.toContain(apiKey);
    expect(stored).not.toContain("1234");
  });

  it("uses a fresh IV, so the same key encrypts differently each time", () => {
    const id = randomUUID();
    expect(encryptApiKey(apiKey, id, masterKey)).not.toBe(encryptApiKey(apiKey, id, masterKey));
  });

  it("fails for a different connection id (ciphertext moved to another row)", () => {
    const stored = encryptApiKey(apiKey, randomUUID(), masterKey);
    expect(decryptApiKey(stored, randomUUID(), masterKey)).toEqual({ ok: false });
  });

  it("fails for a tampered ciphertext", () => {
    const id = randomUUID();
    const [iv, tag, ciphertext] = encryptApiKey(apiKey, id, masterKey).split(".") as [
      string,
      string,
      string,
    ];
    const bytes = Buffer.from(ciphertext, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    expect(decryptApiKey([iv, tag, bytes.toString("base64")].join("."), id, masterKey)).toEqual({
      ok: false,
    });
  });

  it("fails for a tampered tag", () => {
    const id = randomUUID();
    const [iv, tag, ciphertext] = encryptApiKey(apiKey, id, masterKey).split(".") as [
      string,
      string,
      string,
    ];
    const bytes = Buffer.from(tag, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    expect(
      decryptApiKey([iv, bytes.toString("base64"), ciphertext].join("."), id, masterKey),
    ).toEqual({ ok: false });
  });

  it("fails with a different master key", () => {
    const id = randomUUID();
    const stored = encryptApiKey(apiKey, id, masterKey);
    expect(decryptApiKey(stored, id, randomBytes(32))).toEqual({ ok: false });
  });

  it.each(["", "not-encrypted", "a.b", "a.b.c.d"])("fails for malformed input %j", stored => {
    expect(decryptApiKey(stored, randomUUID(), masterKey)).toEqual({ ok: false });
  });

  it("shows only the last four characters", () => {
    expect(lastFour(apiKey)).toBe("1234");
  });
});

describe("parseCredentialsKey", () => {
  it("accepts base64 that decodes to 32 bytes", () => {
    expect(parseCredentialsKey(randomBytes(32).toString("base64"))).toHaveLength(32);
  });

  it("reports a missing key", () => {
    expect(() => parseCredentialsKey(undefined)).toThrow(MissingConfigurationError);
    expect(() => parseCredentialsKey("")).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });

  it("rejects the wrong length", () => {
    expect(() => parseCredentialsKey(randomBytes(16).toString("base64"))).toThrow(
      /CREDENTIALS_ENCRYPTION_KEY/,
    );
  });

  it("rejects text that is not base64, without echoing it", () => {
    let message = "";
    try {
      parseCredentialsKey("not base64 at all!!");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/CREDENTIALS_ENCRYPTION_KEY/);
    expect(message).not.toContain("not base64");
  });
});
