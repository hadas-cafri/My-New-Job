import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_ID,
  DEFAULT_TABLE_ID,
  STORAGE_KEY,
  clearSavedToken,
  describeConnectError,
  loadSaved,
  maskToken,
  saveConnection,
  validateIds,
  validateToken,
  type StorageLike,
} from "@/lib/connection";

const memoryStorage = (initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
};

const CONN = { token: "patABCDEF1234567890.secretpart", baseId: "appAnHmtOjUfgQAcA", tableId: "tblyQ1DaQW5A7wJbA" };

describe("saving the connection", () => {
  it("does NOT store the token unless 'remember' is ticked", () => {
    const s = memoryStorage();
    saveConnection(CONN, false, s);
    expect(s.data[STORAGE_KEY]).not.toContain("patABCDEF");
    expect(loadSaved(s)).toEqual({ token: null, baseId: CONN.baseId, tableId: CONN.tableId });
  });

  it("stores the token when 'remember' is ticked", () => {
    const s = memoryStorage();
    saveConnection(CONN, true, s);
    expect(loadSaved(s).token).toBe(CONN.token);
  });

  it("'delete saved key' removes the token but keeps the IDs", () => {
    const s = memoryStorage();
    saveConnection(CONN, true, s);
    clearSavedToken(s);
    expect(s.data[STORAGE_KEY]).not.toContain("patABCDEF");
    expect(loadSaved(s)).toEqual({ token: null, baseId: CONN.baseId, tableId: CONN.tableId });
  });

  it("un-ticking 'remember' on the next connect wipes a previously saved token", () => {
    const s = memoryStorage();
    saveConnection(CONN, true, s);
    saveConnection(CONN, false, s);
    expect(loadSaved(s).token).toBeNull();
  });
});

describe("loading", () => {
  it("returns defaults when nothing is saved", () => {
    expect(loadSaved(memoryStorage())).toEqual({
      token: null,
      baseId: DEFAULT_BASE_ID,
      tableId: DEFAULT_TABLE_ID,
    });
  });

  it("survives corrupted storage and missing storage", () => {
    expect(loadSaved(memoryStorage({ [STORAGE_KEY]: "{not json" })).token).toBeNull();
    expect(loadSaved(null).baseId).toBe(DEFAULT_BASE_ID);
  });

  it("never throws when storage itself throws (private mode / blocked)", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => loadSaved(broken)).not.toThrow();
    expect(() => saveConnection(CONN, true, broken)).not.toThrow();
    expect(() => clearSavedToken(broken)).not.toThrow();
  });
});

describe("validation", () => {
  it("accepts the real IDs and rejects typos", () => {
    expect(validateIds(CONN.baseId, CONN.tableId)).toBeNull();
    expect(validateIds("tblyQ1DaQW5A7wJbA", CONN.tableId)).toMatch(/Base ID/);
    expect(validateIds(CONN.baseId, "appAnHmtOjUfgQAcA")).toMatch(/Table ID/);
    expect(validateIds("app123", CONN.tableId)).toMatch(/Base ID/);
  });

  it("rejects short tokens and tokens with whitespace", () => {
    expect(validateToken("short")).not.toBeNull();
    expect(validateToken("pat has spaces 12345")).not.toBeNull();
    expect(validateToken(CONN.token)).toBeNull();
  });
});

describe("messages", () => {
  it("gives a distinct Hebrew message per failure", () => {
    const msgs = [401, 403, 404, 429, 0, 500].map(describeConnectError);
    expect(new Set(msgs).size).toBe(msgs.length);
    expect(describeConnectError(404)).toMatch(/Base ID/);
  });

  it("masks the token for display", () => {
    expect(maskToken(CONN.token)).toBe("pat••••part");
    expect(maskToken("short")).toBe("••••");
  });
});
