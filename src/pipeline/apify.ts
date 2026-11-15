import { TRANSIENT_STATUS, TransientError, withRetry } from "./retry";
import type { Collector } from "./run";
import type { RawJob } from "./types";

const API = "https://api.apify.com/v2";
const FINISHED = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

/**
 * Runs one Apify actor and returns its dataset items. Transient failures (502/503/504/429,
 * network) are retried; a failed run or a bad token is reported as it is.
 */
export function createApifyCollector(opts: {
  token: string;
  fetchImpl?: typeof fetch;
  /** Wait between status checks while a run is in progress is done by Apify (`waitForFinish`); this only caps the loop. */
  maxPolls?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Collector {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const retry = { delayMs: opts.retryDelayMs ?? 2000, sleep: opts.sleep };

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    return withRetry(async () => {
      let res: Response;
      try {
        res = await doFetch(`${API}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json", ...init.headers },
        });
      } catch (e) {
        throw new TransientError(`${init.method ?? "GET"} ${path.split("?")[0]} -> network error: ${(e as Error).message}`);
      }
      if (!res.ok) {
        const msg = `${init.method ?? "GET"} ${path.split("?")[0]} -> ${res.status}`;
        throw TRANSIENT_STATUS.has(res.status) ? new TransientError(msg) : new Error(msg);
      }
      return (await res.json()) as T;
    }, retry);
  }

  return async (cfg) => {
    const actor = encodeURIComponent(cfg.actor.replace("/", "~"));
    let { data: run } = await api<{ data: { id: string; status: string; defaultDatasetId: string } }>(
      `/acts/${actor}/runs?waitForFinish=60`,
      { method: "POST", body: JSON.stringify(cfg.input) },
    );
    for (let polls = 0; !FINISHED.has(run.status); polls++) {
      if (polls >= (opts.maxPolls ?? 20)) throw new Error(`${cfg.actor}: still running after ${polls} checks, giving up`);
      run = (await api<{ data: typeof run }>(`/actor-runs/${run.id}?waitForFinish=60`)).data;
    }
    if (run.status !== "SUCCEEDED") throw new Error(`${cfg.actor}: run ${run.status}`);
    return api<RawJob[]>(`/datasets/${run.defaultDatasetId}/items?clean=true&limit=1000`);
  };
}
