const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes base64 without Buffer/atob, which are not available everywhere in React Native. */
export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0; let bits = 0; let out = 0;
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | ALPHABET.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes[out++] = (buffer >> bits) & 0xff; }
  }
  return bytes.subarray(0, out);
}
