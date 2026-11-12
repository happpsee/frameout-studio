import { PROVIDER_IDS } from '@frameout/shared';
import type { Provider } from '../types';
import { desktopBridge } from './platform';

// Desktop only: API keys the user opted to remember, decrypted by the main process.
// The browser build never persists keys, so everything here is a no-op there.
const remembered = new Map<Provider, string>();
let available = false;

export async function loadRememberedKeys(): Promise<void> {
  available = false;
  remembered.clear();
  const secrets = desktopBridge()?.secrets;
  if (!secrets) return;
  try {
    available = await secrets.available();
    if (!available) return;
    const keys = await secrets.read();
    for (const provider of PROVIDER_IDS) {
      const key = keys[provider];
      if (typeof key === 'string' && key) remembered.set(provider, key);
    }
  } catch {
    available = false;
    remembered.clear();
  }
}

export const canRememberKeys = () => available;
export const rememberedKey = (provider: Provider) => remembered.get(provider) ?? '';

/** Saves (or with null forgets) a provider key in the keychain. */
export async function rememberKey(provider: Provider, key: string | null): Promise<void> {
  const secrets = desktopBridge()?.secrets;
  if (!secrets || !available) return;
  await secrets.write(provider, key);
  if (key) remembered.set(provider, key);
  else remembered.delete(provider);
}
