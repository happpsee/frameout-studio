import { PROVIDERS } from './ai-client';
import type { AIConfig, Provider } from '../types';
import { preferenceOnly } from './project';
import { PREFERENCES_KEY, readStoredValue, writeStoredValue } from './desktop-storage';
export { PREFERENCES_KEY } from './desktop-storage';
export const providerIds: Provider[] = ['openai', 'ark', 'compatible'];
export function defaults(provider: Provider = 'openai'): AIConfig {
  const preset = PROVIDERS[provider];
  return { provider, baseUrl: preset.baseUrl, key: '', imageModel: preset.defaultImageModel, videoModel: preset.defaultVideoModel, imageSize: preset.imageSizes[0], duration: Number(preset.videoDurations[0]) || 5, videoRatio: '16:9', resolution: '720p', transport: provider === 'compatible' ? 'direct' : 'proxy' };
}
export function loadProfiles(): { active: Provider; profiles: Partial<Record<Provider, AIConfig>> } {
  try {
    const saved = JSON.parse(readStoredValue(PREFERENCES_KEY) || 'null');
    if (!saved || saved.version !== 1) return { active: 'openai', profiles: {} };
    const profiles: Partial<Record<Provider, AIConfig>> = {};
    for (const id of providerIds) if (saved.profiles?.[id]) profiles[id] = { ...defaults(id), ...preferenceOnly(saved.profiles[id]), provider: id, key: '' };
    return { active: providerIds.includes(saved.active) ? saved.active : 'openai', profiles };
  } catch { return { active: 'openai', profiles: {} }; }
}
export function saveProfile(config: AIConfig) {
  const saved = loadProfiles();
  const profiles = { ...saved.profiles, [config.provider]: config };
  const safe = Object.fromEntries(providerIds.filter(id => profiles[id]).map(id => [id, preferenceOnly(profiles[id]!)]));
  try { void writeStoredValue(PREFERENCES_KEY, JSON.stringify({ version: 1, active: config.provider, profiles: safe }))?.catch(() => {}); } catch { /* Preferences are optional. */ }
}
export function initialConfig(): AIConfig { const { active, profiles } = loadProfiles(); return profiles[active] || defaults(active); }
export function redact(value: unknown, key = '') {
  return String(value || '请求失败，请检查配置后重试').split(key || '\u0000').join('[已隐藏]').replace(/Bearer\s+[^\s,;"<>]+/gi, 'Bearer [已隐藏]').replace(/sk-[A-Za-z0-9_-]{6,}/g, '[已隐藏]').slice(0, 400);
}
