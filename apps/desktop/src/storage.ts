import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { types } from 'node:util';
import { MAX_MEDIA_BYTES, MEDIA_HEADER_MAX_BYTES, queue } from '@frameout/shared';

// A stored media file is its type header plus at most MAX_MEDIA_BYTES of data.
const MAX_VALUE_BYTES = MAX_MEDIA_BYTES + MEDIA_HEADER_MAX_BYTES;
const KEY = /^[a-zA-Z0-9_-]{1,128}$/;

export interface Storage {
  /** `key` and `data` come from IPC, so they are validated at runtime. */
  read(key: unknown): Promise<ArrayBuffer | null>;
  write(key: unknown, data: unknown): Promise<void>;
}

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException => error instanceof Error && 'code' in error;

function checkKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !KEY.test(key)) throw new TypeError('不允许操作非独属文件夹');
}

export function createStorage(directory: string): Storage {
  // Remove temporary files left by a write that was interrupted.
  try {
    for (const name of fsSync.readdirSync(directory)) {
      if (name.endsWith('.tmp')) fsSync.rmSync(path.join(directory, name), { force: true });
    }
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
  }

  return {
    read(key) {
      checkKey(key);
      return queue(path.join(directory, `${key}.data`), async file => {
        try {
          const { size } = await fs.stat(file);
          if (size > MAX_VALUE_BYTES) throw new RangeError('Storage value is too large');
          const bytes = await fs.readFile(file);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        } catch (error) {
          if (isErrnoException(error) && error.code === 'ENOENT') return null;
          throw error;
        }
      });
    },
    write(key, data) {
      checkKey(key);
      if (!types.isArrayBuffer(data)) throw new TypeError('Storage value must be an ArrayBuffer');
      if (data.byteLength > MAX_VALUE_BYTES) throw new RangeError('Storage value is too large');
      return queue(path.join(directory, `${key}.data`), async file => {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        // Write to a temporary file, then rename, so a crash never leaves a half-written value.
        const temporary = path.join(directory, `.${randomUUID()}.tmp`);
        try {
          const handle = await fs.open(temporary, 'wx', 0o600);
          try {
            await handle.writeFile(Buffer.from(data));
            await handle.sync();
          } finally {
            await handle.close();
          }
          await fs.rename(temporary, file);
        } catch (error) {
          await fs.rm(temporary, { force: true }).catch(() => {});
          throw error;
        }
      });
    },
  };
}
