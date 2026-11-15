/** An error that is worth retrying: 429, 5xx, or a network failure. Real errors (401, bad input) are not. */
export class TransientError extends Error {
  readonly transient = true;
}

export const isTransient = (e: unknown): boolean => (e as { transient?: boolean } | null)?.transient === true;

export const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Retries `fn` while it throws a transient error, waiting delayMs, 2*delayMs, ... between attempts.
 * Seen in the real Apify trial: a "502 upstream request failed" that worked a minute later.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const { retries = 2, delayMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e) || attempt >= retries) throw e;
      await sleep(delayMs * 2 ** attempt);
    }
  }
}
