import type { Complete } from "./match";
import { TRANSIENT_STATUS, TransientError, withRetry } from "./retry";

/** Default model for scoring. Override with the MATCH_MODEL environment variable (quality vs cost). */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

/**
 * A `Complete` backed by the Anthropic Messages API.
 * NOT yet verified against the live API (no key was available when it was written): it follows the
 * documented request/response shape and is tested with a fake `fetch`.
 */
export function createAnthropicComplete(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Complete {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  return ({ system, user, maxTokens }) =>
    withRetry(
      async () => {
        let res: Response;
        try {
          res = await doFetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({
              model: opts.model ?? DEFAULT_MODEL,
              max_tokens: maxTokens,
              system,
              messages: [{ role: "user", content: user }],
            }),
          });
        } catch {
          throw new TransientError("Anthropic API: network error");
        }
        // 529 = overloaded. The error text never includes the key or the request body.
        if (!res.ok) {
          const msg = `Anthropic API ${res.status}`;
          throw TRANSIENT_STATUS.has(res.status) || res.status === 529 ? new TransientError(msg) : new Error(msg);
        }
        const data = (await res.json()) as { content?: { type: string; text?: string }[] };
        const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
        if (!text) throw new Error("Anthropic API: empty reply");
        return text;
      },
      { retries: 2, delayMs: opts.retryDelayMs ?? 3000, sleep: opts.sleep },
    );
}
