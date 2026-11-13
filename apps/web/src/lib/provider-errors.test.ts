import { describe, expect, it } from 'vitest';
import { MODERATION_MESSAGE, moderationMessage, submitFailure } from './provider-errors';

describe('moderationMessage', () => {
  it('recognizes provider safety codes and messages', () => {
    expect(moderationMessage('OutputImageSensitiveContentDetected', '')).toBe(MODERATION_MESSAGE);
    expect(moderationMessage(undefined, 'rejected by the safety system')).toBe(MODERATION_MESSAGE);
    expect(
      moderationMessage('InputImageSensitiveContentDetected.PrivacyInformation', ''),
    ).toContain('真人');
  });
  it('leaves other failures alone', () => {
    expect(moderationMessage('InvalidParameter', 'size is invalid')).toBeUndefined();
    expect(moderationMessage(undefined, undefined)).toBeUndefined();
  });
});

describe('submitFailure', () => {
  it('treats 4xx replies and safety rejections as definite refusals', () => {
    expect(submitFailure({ code: 'UPSTREAM_ERROR', status: 400 })).toBe('rejected');
    expect(submitFailure({ code: 'UPSTREAM_ERROR', status: 429 })).toBe('rejected');
    expect(submitFailure({ code: 'CONTENT_REJECTED', status: 200 })).toBe('rejected');
  });
  it('knows local checks were never sent', () => {
    expect(submitFailure({ code: 'CONFIG_REFERENCE' })).toBe('not-sent');
    expect(submitFailure({ code: 'VIDEO_UNAVAILABLE' })).toBe('not-sent');
  });
  it('keeps network errors, timeouts and 5xx unclear', () => {
    expect(submitFailure({ code: 'NETWORK_ERROR' })).toBe('unknown');
    expect(submitFailure({ code: 'TIMEOUT' })).toBe('unknown');
    expect(submitFailure({ code: 'UPSTREAM_ERROR', status: 502 })).toBe('unknown');
    expect(submitFailure({ code: 'INVALID_RESPONSE', status: 0 })).toBe('unknown');
    expect(submitFailure(new Error('boom'))).toBe('unknown');
  });
});
