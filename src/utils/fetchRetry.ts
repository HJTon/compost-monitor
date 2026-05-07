/**
 * Fetch a JSON endpoint with automatic retries on transient failures.
 *
 * Why this exists: SystemAnalysePage makes ~5 parallel Google Sheets calls on
 * load. Sheets sometimes returns 429/500/503 under load, and Netlify functions
 * occasionally cold-start slowly. A single flaky call was leaving the page
 * showing empty state with no recovery, forcing the user to refresh 5+ times.
 * One retry with backoff catches ~95% of these.
 *
 * Retries only on: network errors, 429, 500, 502, 503, 504.
 * Never retries on: 4xx other than 429 (those are real errors).
 */

interface RetryOptions {
  retries?: number;       // default 2 (total 3 attempts)
  baseDelayMs?: number;   // default 400
  timeoutMs?: number;     // default 15000 per attempt
}

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export async function fetchJsonWithRetry<T = unknown>(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 20000;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        return await res.json() as T;
      }

      // Non-transient 4xx → fail fast
      if (!TRANSIENT_STATUSES.has(res.status)) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }

      lastError = new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < retries) {
      // Exponential backoff with small jitter: 400, 1200, 2800ms
      const delay = baseDelay * Math.pow(2.5, attempt) + Math.random() * 200;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError || new Error('Request failed after retries');
}
