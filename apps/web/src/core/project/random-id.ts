/**
 * 32 random hex characters. Not crypto.randomUUID: browsers only provide it on HTTPS or
 * localhost, and the web build is also served over plain HTTP by IP address.
 */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
