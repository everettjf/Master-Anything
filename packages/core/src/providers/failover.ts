/**
 * Failover provider (inspired by openclaw's model failover): try providers in
 * order, falling through to the next on error. Lets you set a primary plus
 * cheaper/redundant fallbacks so a single vendor outage or rate limit doesn't
 * break the loop.
 */
import type { CompleteOptions, LlmProvider } from "../enrich.js";

export class FailoverProvider implements LlmProvider {
  constructor(private readonly providers: LlmProvider[]) {
    if (providers.length === 0) throw new Error("FailoverProvider needs at least one provider");
  }

  async complete(opts: CompleteOptions): Promise<string> {
    let lastErr: unknown;
    for (const p of this.providers) {
      try {
        return await p.complete(opts);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
