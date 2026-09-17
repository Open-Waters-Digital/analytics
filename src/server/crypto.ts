import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for client API keys at rest: AES-256-GCM, with the connection's id
 * as associated data. A ciphertext copied onto another connection's row fails
 * authentication instead of decrypting to the first connection's key.
 *
 * Stored format: base64(iv).base64(tag).base64(ciphertext), plus key_version in
 * its own column so the master key can rotate later without a data migration.
 *
 * The master key is passed in rather than read here, which keeps this module
 * pure and lets callers decide how a missing key is reported.
 */

export const KEY_VERSION = 1;

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptApiKey(apiKey: string, connectionId: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(connectionId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map(part => part.toString("base64")).join(".");
}

export type DecryptResult = { ok: true; apiKey: string } | { ok: false };

export function decryptApiKey(
  stored: string,
  connectionId: string,
  masterKey: Buffer,
): DecryptResult {
  try {
    const parts = stored.split(".");
    if (parts.length !== 3) return { ok: false };
    const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, "base64")) as [
      Buffer,
      Buffer,
      Buffer,
    ];
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return { ok: false };

    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(connectionId, "utf8"));
    decipher.setAuthTag(tag);
    const apiKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return { ok: true, apiKey };
  } catch {
    // Wrong master key, wrong connection id, or tampered data: all the same to
    // the caller, and none of them should reveal anything.
    return { ok: false };
  }
}

/** The only part of a key the UI ever shows. */
export function lastFour(apiKey: string): string {
  return apiKey.slice(-4);
}
