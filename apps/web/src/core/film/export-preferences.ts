import {
  EXPORT_PREFERENCES_KEY,
  readStoredValue,
  writeStoredValue,
} from '../project/desktop-storage';

export const EXPORT_RATIOS = ['16:9', '9:16', '1:1'] as const;
export const EXPORT_QUALITIES = ['720p', '1080p'] as const;
export type ExportRatio = (typeof EXPORT_RATIOS)[number];
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];
interface ExportPreferences {
  ratio: ExportRatio;
  quality: ExportQuality;
}

const FALLBACK: ExportPreferences = { ratio: '16:9', quality: '1080p' };
const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

/** The ratio and quality chosen for the last export, or the defaults. */
export function loadExportPreferences(): ExportPreferences {
  try {
    const saved = JSON.parse(readStoredValue(EXPORT_PREFERENCES_KEY) || 'null');
    return {
      ratio: pick(EXPORT_RATIOS, saved?.ratio, FALLBACK.ratio),
      quality: pick(EXPORT_QUALITIES, saved?.quality, FALLBACK.quality),
    };
  } catch {
    return FALLBACK;
  }
}

export function saveExportPreferences(preferences: ExportPreferences): void {
  try {
    void writeStoredValue(EXPORT_PREFERENCES_KEY, JSON.stringify(preferences))?.catch(() => {});
  } catch {
    /* Remembering the choice is optional. */
  }
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "<项目名>-成片-YYYYMMDD-HHmm.mp4", with characters that file systems reject replaced. */
export function exportFileName(title: string, date = new Date()): string {
  const name =
    title
      // eslint-disable-next-line no-control-regex -- control characters are illegal in file names
      .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '-')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 80) || '帧外';
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${name}-成片-${stamp}.mp4`;
}
