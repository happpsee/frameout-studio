// Waiting and retrying, from the practice in the repository's index.js, typed for the engine.
// Rules: docs/architecture/retry-and-concurrency.md §4.

/** Waits `ms`; rejects at once when `signal` aborts, so a cancelled task never sits out a backoff. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Exponential backoff with jitter: about 1s, 2s, 4s, each times 0.5 to 1.5, never above `max`. */
export const retryDelay = (failed: number, initial: number, max: number) =>
  Math.min(initial * 2 ** (failed - 1), max) * (0.5 + Math.random());

export interface RetryOptions {
  /** Attempts after the first one. */
  retries?: number;
  initialDelay?: number;
  maxDelay?: number;
  /** Only errors that prove the request was not carried out may be retried. */
  retryable?: (error: unknown) => boolean;
}

/** Runs `task`, and runs it again after a pause while it fails with a retryable error. */
export async function withRetry<T>(
  task: (signal?: AbortSignal) => Promise<T>,
  { retries = 2, initialDelay = 1000, maxDelay = 30000, retryable = () => true }: RetryOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  for (let failed = 1; ; failed++) {
    try {
      return await task(signal);
    } catch (error) {
      if (signal?.aborted || failed > retries || !retryable(error)) throw error;
      await sleep(retryDelay(failed, initialDelay, maxDelay), signal);
    }
  }
}
