import assert from 'node:assert/strict';
import { test } from 'vitest';
import { withRetry } from './retry.ts';

const fast = { initialDelay: 1, maxDelay: 1 };

test('retries a retryable failure, then returns the result', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    if (++calls < 3) throw new Error('busy');
    return 'ok';
  }, fast);
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('never retries an error that is not retryable: it may already have been charged', async () => {
  let calls = 0;
  const failing = withRetry(
    async () => {
      calls++;
      throw new Error('timeout');
    },
    { ...fast, retryable: () => false },
  );
  await assert.rejects(failing, /timeout/);
  assert.equal(calls, 1);
});

test('a cancel during the backoff stops at once', async () => {
  const controller = new AbortController();
  let calls = 0;
  const running = withRetry(
    async () => {
      calls++;
      setTimeout(() => controller.abort(new Error('cancelled')), 5);
      throw new Error('busy');
    },
    { initialDelay: 60_000, maxDelay: 60_000 },
    controller.signal,
  );
  await assert.rejects(running, /cancelled/);
  assert.equal(calls, 1);
});
