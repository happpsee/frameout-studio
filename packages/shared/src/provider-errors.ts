// Reading provider failures: safety rejections and whether a failed submission reached the provider.

export const MODERATION_MESSAGE = '内容被供应商的安全审核拒绝，请调整描述或参考图后再试';
export const PRIVACY_MESSAGE = '图片可能含有真人人像，被供应商的安全审核拒绝，请换一张图后再试';

// Ark: *SensitiveContentDetected codes, some with a .PrivacyInformation suffix.
// OpenAI: moderation_blocked, content_policy_violation. Through the backend relay only
// the provider's message survives, so the English wording is matched as well.
const PRIVACY = /PrivacyInformation|privacy information|real person/i;
const MODERATION =
  /SensitiveContent|sensitive (?:content|information)|moderation|content[_ ]policy|safety system|content[_ ]filter|敏感|安全审核/i;

/** The Chinese message for a safety rejection, or undefined when the failure is something else. */
export function moderationMessage(code: unknown, detail: unknown): string | undefined {
  const text = [code, detail].filter(value => typeof value === 'string').join(' ');
  if (!text) return undefined;
  if (PRIVACY.test(text)) return PRIVACY_MESSAGE;
  if (MODERATION.test(text)) return MODERATION_MESSAGE;
  return undefined;
}

/**
 * How a failed video submission ended:
 * - `not-sent`: checked locally and never sent.
 * - `rejected`: the provider or the relay answered with a definite refusal (HTTP 4xx), so no task exists.
 * - `unknown`: network error, timeout, 5xx or an unreadable reply; the provider may have received it.
 */
export type SubmitFailure = 'not-sent' | 'rejected' | 'unknown';
export function submitFailure(error: unknown): SubmitFailure {
  if (!error || typeof error !== 'object') return 'unknown';
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (code === 'CONTENT_REJECTED') return 'rejected';
  if (typeof code === 'string' && (code.startsWith('CONFIG_') || code === 'VIDEO_UNAVAILABLE'))
    return 'not-sent';
  if (code === 'UPSTREAM_ERROR' && typeof status === 'number' && status >= 400 && status < 500)
    return 'rejected';
  return 'unknown';
}
