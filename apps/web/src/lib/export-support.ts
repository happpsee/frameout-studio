/** WebCodecs video encoding; kept apart from export-video so checking it does not load the encoder library. */
export function exportSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/** Decoding and encoding sound for the export: WebCodecs audio plus Web Audio for resampling. */
export function exportAudioSupported(): boolean {
  return (
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioDecoder !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined' &&
    typeof AudioBuffer !== 'undefined'
  );
}
