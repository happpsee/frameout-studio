/** WebCodecs video encoding; kept apart from export-video so checking it does not load the encoder library. */
export function exportSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}
