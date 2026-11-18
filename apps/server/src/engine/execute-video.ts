// Runs one video task: submits it once, saves the provider's job id, polls until it ends, then
// saves the video next to the task files. After a restart it is called again and only polls.
// Which failures may be retried: docs/architecture/retry-and-concurrency.md §3.
import fs from 'node:fs/promises';
import path from 'node:path';
import { AIError, createClient, MAX_MEDIA_BYTES } from '@frameout/shared';
import {
  download,
  notCarriedOut,
  outcomeOf,
  resultPath,
  type ImageFile as ResultFile,
} from './execute-image.ts';
import { sleep, withRetry } from './retry.ts';
import type { Execute, Outcome } from './task.ts';

/** `task.request` of a video task. */
export interface VideoRequest {
  prompt: string;
  /** First frame, as a data URL or a public HTTPS URL. */
  reference?: string;
  /** Instead of a first frame: reference images and audio, named @图像N / @音频N in the prompt. */
  images?: string[];
  audios?: string[];
  ratio: string;
  duration: number;
  resolution: string;
}

export interface VideoExecutorOptions {
  directory: string;
  /** Milliseconds, for each request to the provider. */
  timeoutMs: number;
  /** Pause between status checks: the first minute, then after it. */
  pollMs?: [number, number];
  /** Stop polling after this long; the job may still finish at the provider. */
  maxWaitMs?: number;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
}

const VIDEO_MIME = /^video\/(?:mp4|webm|quicktime)$/;
const NOT_SAVED_MESSAGE =
  '视频已经生成并计费，但没能保存到本机。请检查网络和磁盘空间，可到供应商控制台下载';

/** A status check only reads, so any failure that is not a refusal may be tried again. */
const transient = (error: unknown) =>
  !(error instanceof AIError) ||
  ['TIMEOUT', 'NETWORK_ERROR'].includes(error.code) ||
  error.status === 429 ||
  error.status >= 500;

export function createVideoExecutor({
  directory,
  timeoutMs,
  pollMs = [3000, 7000],
  maxWaitMs = 30 * 60 * 1000,
  fetchImpl = globalThis.fetch,
}: VideoExecutorOptions): Execute {
  const fetcher = fetchImpl as typeof fetch;
  return async (task, { key, update }) => {
    const request = task.request as VideoRequest | undefined;
    let jobId = task.providerJobId;
    const client = createClient(
      {
        provider: task.provider,
        baseUrl: task.baseUrl,
        key,
        videoModel: task.model,
        videoRatio: request?.ratio,
        duration: request?.duration,
        resolution: request?.resolution,
        transport: 'direct',
      },
      { fetchImpl: fetcher, timeoutMs },
    );

    // Submitting charges; it is retried only when the provider says it did not start.
    if (!jobId) {
      if (!request)
        return { status: 'failed', error: { code: 'INVALID_TASK', message: '任务缺少生成内容' } };
      try {
        const submitted = await withRetry(
          () =>
            client.submitVideo({
              prompt: request.prompt,
              reference: request.reference,
              references: { images: request.images, audios: request.audios },
            }),
          { retries: 2, retryable: notCarriedOut },
        );
        jobId = submitted.id;
      } catch (error) {
        return outcomeOf(error);
      }
      // If this write fails, polling still goes on; only a restart would lose the job.
      await update({ providerJobId: jobId }).catch(() => {});
    }

    const lost = (code: string): Outcome => ({
      status: 'interrupted',
      error: {
        code,
        message: `没能查到视频结果，任务可能仍在供应商那里完成并计费。任务号 ${jobId}，可到供应商控制台查看`,
      },
    });
    const started = Date.now();
    for (;;) {
      let result;
      try {
        result = await withRetry(() => client.getVideo({ id: jobId }), {
          retries: 4,
          retryable: transient,
        });
      } catch (error) {
        return lost(error instanceof AIError ? error.code : 'POLL_ERROR');
      }
      if (result.status === 'failed')
        return {
          status: 'failed',
          error: { code: 'PROVIDER_FAILED', message: result.error || '供应商返回生成失败' },
        };
      if (result.status === 'succeeded') return save(task.id, result);
      if (result.progress !== undefined) void update({ progress: result.progress }).catch(() => {});
      const waited = Date.now() - started;
      if (waited > maxWaitMs) return lost('POLL_TIMEOUT');
      await sleep(waited > 60000 ? pollMs[1] : pollMs[0]);
    }
  };

  async function save(id: string, result: { src?: string; data?: Blob }): Promise<Outcome> {
    try {
      const { bytes, mime } = result.data
        ? { bytes: Buffer.from(await result.data.arrayBuffer()), mime: result.data.type }
        : await withRetry(() => download(result.src ?? '', fetcher, timeoutMs, VIDEO_MIME), {
            retries: 2,
          });
      if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new Error('Video size');
      const file = resultPath(directory, id);
      await fs.writeFile(file, bytes, { mode: 0o600 });
      const saved: ResultFile = { file: path.basename(file), mime: mime || 'video/mp4' };
      return { status: 'succeeded', result: saved };
    } catch {
      return {
        status: 'interrupted',
        error: { code: 'RESULT_NOT_SAVED', message: NOT_SAVED_MESSAGE },
      };
    }
  }
}
