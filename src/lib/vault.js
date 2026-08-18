/**
 * Keeps tokens out of the profile as recognisable text.
 *
 * Be clear about what this is: obfuscation, not protection. gitchop has to be able to read the
 * token unattended, so the key sits beside the ciphertext, and anyone who can read one can read the
 * other. What it does buy is that a token no longer appears anywhere as `ghp_…` — not to a grep over
 * the profile, a backup scanner, a screenshot of storage, a stray log line, or another tool trawling
 * for credential shapes. That is a real class of accidental exposure, and it is the only class this
 * defends against. Anyone with the disk still has the token.
 */
const ALGO = 'AES-GCM';
const IV_BYTES = 12;

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

export function newVaultKey() {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

async function importKey(keyBase64) {
  return crypto.subtle.importKey('raw', fromBase64(keyBase64), { name: ALGO, length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function seal(secret, keyBase64) {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: ALGO, iv }, key, new TextEncoder().encode(secret));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

export async function unseal(blob, keyBase64) {
  const [ivPart, dataPart] = String(blob ?? '').split('.');
  if (!ivPart || !dataPart) throw new Error('Stored token is unreadable.');
  const key = await importKey(keyBase64);
  const opened = await crypto.subtle.decrypt(
    { name: ALGO, iv: fromBase64(ivPart) },
    key,
    fromBase64(dataPart),
  );
  return new TextDecoder().decode(opened);
}
