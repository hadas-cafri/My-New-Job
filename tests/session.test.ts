import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, maskToken } from "@/lib/session";

const SECRET = "test-secret-with-enough-length";
const TOKEN = "patABCDEF1234567890.secretpart";

describe("token cookie encryption", () => {
  it("round-trips", () => {
    expect(decryptToken(encryptToken(TOKEN, SECRET), SECRET)).toBe(TOKEN);
  });

  it("never contains the plaintext token", () => {
    expect(encryptToken(TOKEN, SECRET)).not.toContain("patABCDEF");
  });

  it("uses a fresh IV every time", () => {
    expect(encryptToken(TOKEN, SECRET)).not.toBe(encryptToken(TOKEN, SECRET));
  });

  it("rejects a wrong secret", () => {
    expect(decryptToken(encryptToken(TOKEN, SECRET), "another-secret-1234567")).toBeNull();
  });

  it("rejects tampered values", () => {
    const enc = encryptToken(TOKEN, SECRET);
    const flipped = enc.slice(0, -2) + (enc.endsWith("A") ? "BB" : "AA");
    expect(decryptToken(flipped, SECRET)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(decryptToken("", SECRET)).toBeNull();
    expect(decryptToken("not-base64-!!!", SECRET)).toBeNull();
  });
});

describe("maskToken", () => {
  it("shows only prefix and suffix", () => {
    const masked = maskToken(TOKEN);
    expect(masked).toBe("pat••••part");
    expect(masked).not.toContain("1234567890");
  });

  it("fully hides short tokens", () => {
    expect(maskToken("short")).toBe("••••");
  });
});
