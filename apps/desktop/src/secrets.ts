import type { SafeStorage } from 'electron';
import { queue } from '@frameout/shared';
import { createStorage } from './storage.ts';

const PROVIDERS = ['openai', 'ark', 'compatible'] as const;
type Provider = (typeof PROVIDERS)[number];
const FILE = 'api-keys';

export type KeyStore = Pick<SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>;
export type SavedKeys = Partial<Record<Provider, string>>;

export interface Secrets {
  available(): boolean;
  read(): Promise<SavedKeys>;
  /** `provider` and `key` come from IPC, so they are validated at runtime. */
  write(provider: unknown, key: unknown): Promise<void>;
}

const isProvider = (value: unknown): value is Provider => PROVIDERS.includes(value as Provider);
const validKey = (value: string) => value.length > 0 && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value);

/**
 * API keys the user chose to remember. They are encrypted with Electron safeStorage
 * (on macOS the encryption key lives in the Keychain) and never stored in plain text.
 */
export function createSecrets(directory: string, safeStorage: KeyStore): Secrets {
  const storage = createStorage(directory);

  async function read(): Promise<SavedKeys> {
    if (!safeStorage.isEncryptionAvailable()) return {};
    const data = await storage.read(FILE);
    if (!data) return {};
    let saved: Record<string, unknown> | null;
    try {
      saved = JSON.parse(safeStorage.decryptString(Buffer.from(data)));
    } catch {
      return {};
    }
    const keys: SavedKeys = {};
    for (const provider of PROVIDERS) {
      const value = saved?.[provider];
      if (typeof value === 'string' && validKey(value)) keys[provider] = value;
    }
    return keys;
  }

  return {
    available: () => safeStorage.isEncryptionAvailable(),
    read,
    write(provider, key) {
      if (!isProvider(provider)) throw new TypeError('Unknown provider');
      if (key !== null && (typeof key !== 'string' || !validKey(key))) throw new TypeError('Invalid API key');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('本机钥匙串不可用');
      // Serialize read-modify-write so two providers saved together do not drop one another.
      return queue(directory, async () => {
        const keys = await read();
        if (key) keys[provider] = key;
        else delete keys[provider];
        const encrypted = safeStorage.encryptString(JSON.stringify(keys));
        await storage.write(FILE, encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength));
      });
    },
  };
}
