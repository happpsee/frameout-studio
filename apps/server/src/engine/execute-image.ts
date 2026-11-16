// Runs one image task: calls the provider, then saves the image next to the task files.
// Which failures may be retried: docs/architecture/retry-and-concurrency.md §3.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AIError, createClient, MAX_MEDIA_BYTES } from '@frameout/shared';
import { withRetry } from './retry.ts';
import { TASK_ID, type Execute, type Outcome } from './task.ts';

/** `task.request` of an image task. */
export interface ImageRequest {
  prompt: string;
  references?: string[];
  size: string;
}

/** `task.result` of a succeeded image task. */
export interface ImageFile {
  file: string;
  mime: string;
}

export interface ImageExecutorOptions {
  /** Where the task files are; results are written beside them. */
  directory: string;
  /** Milliseconds, for each request to the provider. */
  timeoutMs: number;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

const UNKNOWN_MESSAGE =
  '供应商没有给出明确结果，可能已经生成并计费，未自动重试。请先到供应商控制台确认，再决定是否重新生成';
const NOT_SAVED_MESSAGE =
  '图片可能已经生成并计费，但没能保存到本机。请检查网络和磁盘空间，再决定是否重新生成';

/** The result file's path is derived only from the task id. */
export function resultPath(directory: string, id: string): string {
  if (!TASK_ID.test(id)) throw new TypeError('Invalid task id');
  return path.join(directory, `${id}.result`);
}

/** 429 and 503 say the provider did not do the work, so asking again cannot charge twice. */
const notCarriedOut = (error: unknown) =>
  error instanceof AIError &&
  error.code === 'UPSTREAM_ERROR' &&
  (error.status === 429 || error.status === 503);

function outcomeOf(error: unknown): Outcome {
  if (!(error instanceof AIError))
    return { status: 'interrupted', error: { code: 'EXECUTOR_ERROR', message: UNKNOWN_MESSAGE } };
  const { code, status, message, upstreamCode } = error;
  const failed: Outcome = {
    status: 'failed',
    error: { code, message, ...(upstreamCode ? { upstreamCode } : {}) },
  };
  // Checked before the 5xx rule: a 503 that is still refused after the retries definitely failed.
  if (notCarriedOut(error)) return failed;
  // NETWORK_ERROR is here because the client cannot tell "never sent" from "dropped mid-way".
  if (['TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE'].includes(code) || status >= 500)
    return { status: 'interrupted', error: { code, message: UNKNOWN_MESSAGE } };
  return failed;
}

const IMAGE_MIME = /^image\/(?:png|jpeg|webp|gif)$/;

/** The provider's temporary URL, downloaded. Idempotent, so it may be retried. */
async function download(url: string, fetchImpl: typeof fetch, timeoutMs: number) {
  const response = await fetchImpl(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!response.ok || !IMAGE_MIME.test(mime)) throw new Error(`Image download: ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), mime };
}

export function createImageExecutor({
  directory,
  timeoutMs,
  fetchImpl = globalThis.fetch,
}: ImageExecutorOptions): Execute {
  // createClient only ever calls it with a URL string.
  const fetcher = fetchImpl as typeof fetch;
  return async (task, { key }) => {
    const { prompt, references, size } = task.request as ImageRequest;
    let src: string;
    try {
      const client = createClient(
        {
          provider: task.provider,
          baseUrl: task.baseUrl,
          key,
          imageModel: task.model,
          imageSize: size,
          transport: 'direct',
        },
        { fetchImpl: fetcher, timeoutMs },
      );
      ({ src } = await withRetry(() => client.generateImage({ prompt, references }), {
        retries: 2,
        retryable: notCarriedOut,
      }));
    } catch (error) {
      return outcomeOf(error);
    }

    // The provider has done the work; from here on a failure means "paid for, but not saved".
    try {
      const inline = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(src);
      const { bytes, mime } = inline
        ? { bytes: Buffer.from(inline[2], 'base64'), mime: inline[1] }
        : await withRetry(() => download(src, fetcher, timeoutMs), { retries: 2 });
      if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new Error('Image size');
      const file = resultPath(directory, task.id);
      await fs.writeFile(file, bytes, { mode: 0o600 });
      const result: ImageFile = { file: path.basename(file), mime };
      return { status: 'succeeded', result };
    } catch {
      return {
        status: 'interrupted',
        error: { code: 'RESULT_NOT_SAVED', message: NOT_SAVED_MESSAGE },
      };
    }
  };
}
