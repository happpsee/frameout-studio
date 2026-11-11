const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require("node:fs");
const path = require('node:path');
const { types } = require('node:util');
const { queue } = require("../utils/queue");
 
// Media is stored as a 1-byte type length, up to 255 bytes of MIME type, then at most
// 100 MiB of data (MAX_DESKTOP_MEDIA_BYTES in frontend/src/lib/media-store.ts).
const MAX_VALUE_BYTES = 100 * 1024 * 1024 + 256;


function createStorage(directory) {
  try {
    for (const name of fsSync.readdirSync(directory)) {
      if (name.endsWith(".tmp")) fsSync.rmSync(path.join(directory, name), { force: true });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return {
    read(key) {
      if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(key))
        throw TypeError("不允许操作非独属文件夹");
      const file = path.join(directory, `${key}.data`);

      return queue(file, async file => {
        try {
          const { size } = await fs.stat(file);
          if (size > MAX_VALUE_BYTES) throw new RangeError('Storage value is too large');
          const bytes = await fs.readFile(file);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        } catch (error) {
          if (error.code === 'ENOENT') return null;
          throw error;
        }
      });
    },
    write(key, data) {
      if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(key))
        throw TypeError("不允许操作非独属文件夹");
      if (!types.isArrayBuffer(data)) throw new TypeError('Storage value must be an ArrayBuffer');

      if (data.byteLength > MAX_VALUE_BYTES) throw new RangeError('Storage value is too large');
      
      const file = path.join(directory, `${key}.data`);

      return queue(file, async file => {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        
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

module.exports = { createStorage };

