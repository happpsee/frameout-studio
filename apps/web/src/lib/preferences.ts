import { PROVIDER_IDS, PROVIDERS } from '@frameout/shared';
import type { AIConfig, Provider } from '../types';
import { preferenceOnly } from './project';
import { rememberedKey } from './secrets';
import { PREFERENCES_KEY, readStoredValue, writeStoredValue } from './desktop-storage';
export { PREFERENCES_KEY } from './desktop-storage';
export const providerIds: readonly Provider[] = PROVIDER_IDS;
/**
 * Provider for someone who has not saved a choice yet. The interface is Chinese, and Volcano Ark
 * works in mainland China and makes video; OpenAI does neither. Saved choices are never changed.
 */
export const DEFAULT_PROVIDER: Provider = 'ark';
export function defaults(provider: Provider = DEFAULT_PROVIDER): AIConfig {
  const preset = PROVIDERS[provider];
  return {
    provider,
    baseUrl: preset.baseUrl,
    key: '',
    imageModel: preset.defaultImageModel,
    videoModel: preset.defaultVideoModel,
    imageSize: preset.imageSizes[0],
    duration: Number(preset.videoDurations[0]) || 5,
    videoRatio: '16:9',
    resolution: '720p',
    transport: provider === 'compatible' ? 'direct' : 'proxy',
  };
}
export function loadProfiles(): {
  active: Provider;
  profiles: Partial<Record<Provider, AIConfig>>;
} {
  try {
    const saved = JSON.parse(readStoredValue(PREFERENCES_KEY) || 'null');
    if (!saved || saved.version !== 1) return { active: DEFAULT_PROVIDER, profiles: {} };
    const profiles: Partial<Record<Provider, AIConfig>> = {};
    for (const id of providerIds)
      if (saved.profiles?.[id])
        profiles[id] = {
          ...defaults(id),
          ...preferenceOnly(saved.profiles[id]),
          provider: id,
          key: rememberedKey(id),
        };
    const active = providerIds.includes(saved.active)
      ? saved.active
      : (providerIds.find(id => profiles[id]) ?? DEFAULT_PROVIDER);
    return { active, profiles };
  } catch {
    return { active: DEFAULT_PROVIDER, profiles: {} };
  }
}
export function saveProfile(config: AIConfig) {
  const saved = loadProfiles();
  const profiles = { ...saved.profiles, [config.provider]: config };
  const safe = Object.fromEntries(
    providerIds.filter(id => profiles[id]).map(id => [id, preferenceOnly(profiles[id]!)]),
  );
  try {
    void writeStoredValue(
      PREFERENCES_KEY,
      JSON.stringify({ version: 1, active: config.provider, profiles: safe }),
    )?.catch(() => {});
  } catch {
    /* Preferences are optional. */
  }
}
/** Factory defaults plus any key the user chose to remember on this computer. */
export const startingProfile = (provider: Provider): AIConfig => ({
  ...defaults(provider),
  key: rememberedKey(provider),
});
export function initialConfig(): AIConfig {
  const { active, profiles } = loadProfiles();
  return profiles[active] || startingProfile(active);
}
export function redact(value: unknown, key = '') {
  return String(value || '请求失败，请检查配置后重试')
    .split(key || '\u0000')
    .join('[已隐藏]')
    .replace(/Bearer\s+[^\s,;"<>]+/gi, 'Bearer [已隐藏]')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[已隐藏]')
    .slice(0, 400);
}
