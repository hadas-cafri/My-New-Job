import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const COOKIE_NAME = "mnj_at";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const key = (secret: string) => createHash("sha256").update(secret).digest();

/** AES-256-GCM. Output: base64url(iv | authTag | ciphertext). */
export function encryptToken(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

/** Returns null on any failure (tampered value, wrong secret, garbage). */
export function decryptToken(value: string, secret: string): string | null {
  try {
    const buf = Buffer.from(value, "base64url");
    if (buf.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(secret), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Safe-to-display form, e.g. "pat••••1234". */
export function maskToken(token: string): string {
  if (token.length <= 10) return "••••";
  return `${token.slice(0, 3)}••••${token.slice(-4)}`;
}

export function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short (min 16 chars)");
  }
  return s;
}

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: COOKIE_MAX_AGE,
});
