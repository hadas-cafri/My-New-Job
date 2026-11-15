"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_BASE_ID,
  DEFAULT_TABLE_ID,
  clearSavedToken,
  loadSaved,
  saveConnection,
  type Connection,
} from "@/lib/connection";

type Ctx = {
  /** The live connection. The token exists only here, in page memory. */
  conn: Connection | null;
  /** False until localStorage has been read (avoids a flash of the empty form). */
  ready: boolean;
  defaults: { baseId: string; tableId: string; remembered: boolean };
  connect: (c: Connection, remember: boolean) => void;
  forget: () => void;
};

const ConnectionContext = createContext<Ctx | null>(null);

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [conn, setConn] = useState<Connection | null>(null);
  const [ready, setReady] = useState(false);
  const [defaults, setDefaults] = useState({
    baseId: DEFAULT_BASE_ID,
    tableId: DEFAULT_TABLE_ID,
    remembered: false,
  });

  useEffect(() => {
    const saved = loadSaved();
    setDefaults({ baseId: saved.baseId, tableId: saved.tableId, remembered: saved.token !== null });
    if (saved.token) setConn({ token: saved.token, baseId: saved.baseId, tableId: saved.tableId });
    setReady(true);
  }, []);

  const connect = useCallback((c: Connection, remember: boolean) => {
    saveConnection(c, remember);
    setConn(c);
    setDefaults({ baseId: c.baseId, tableId: c.tableId, remembered: remember });
  }, []);

  const forget = useCallback(() => {
    clearSavedToken();
    setConn(null);
    setDefaults((d) => ({ ...d, remembered: false }));
  }, []);

  const value = useMemo(
    () => ({ conn, ready, defaults, connect, forget }),
    [conn, ready, defaults, connect, forget],
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): Ctx {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error("useConnection must be used inside <ConnectionProvider>");
  return ctx;
}
