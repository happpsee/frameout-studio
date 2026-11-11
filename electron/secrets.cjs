const { createStorage } = require('./storage.cjs');
const { queue } = require('../utils/queue');

const PROVIDERS = new Set(['openai', 'ark', 'compatible']);
const FILE = 'api-keys';

/**
 * API keys the user chose to remember. They are encrypted with Electron safeStorage
 * (on macOS the encryption key lives in the Keychain) and never stored in plain text.
 */
function createSecrets(directory, safeStorage) {
  const storage = createStorage(directory);

  async function read() {
    if (!safeStorage.isEncryptionAvailable()) return {};
    const data = await storage.read(FILE);
    if (!data) return {};
    let saved;
    try { saved = JSON.parse(safeStorage.decryptString(Buffer.from(data))); } catch { return {}; }
    const keys = {};
    for (const provider of PROVIDERS) {
      if (typeof saved?.[provider] === 'string' && validKey(saved[provider])) keys[provider] = saved[provider];
    }
    return keys;
  }

  return {
    available: () => safeStorage.isEncryptionAvailable(),
    read,
    write(provider, key) {
      if (!PROVIDERS.has(provider)) throw new TypeError('Unknown provider');
      if (key !== null && (typeof key !== 'string' || !validKey(key))) throw new TypeError('Invalid API key');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('本机钥匙串不可用');
      // Serialize read-modify-write so two providers saved together do not drop one another.
      return queue(directory, async () => {
        const keys = await read();
        if (key) keys[provider] = key; else delete keys[provider];
        const encrypted = safeStorage.encryptString(JSON.stringify(keys));
        await storage.write(FILE, encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength));
      });
    },
  };
}

function validKey(value) {
  return value.length > 0 && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value);
}

module.exports = { createSecrets };
