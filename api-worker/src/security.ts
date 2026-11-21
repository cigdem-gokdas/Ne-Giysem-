export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly waitSeconds?: number) { super(message); }
}

/** Limit streaming bytes, including requests without a Content-Length. */
export async function boundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new HttpError(413, 'İstek boyutu sınırı aşıldı.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'İstek gövdesi boş.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new HttpError(413, 'İstek boyutu sınırı aşıldı.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function inputJson<T>(request: Request, maxBytes = 32_768): Promise<T> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new HttpError(415, 'JSON verisi bekleniyor.');
  const bytes = await boundedBody(request, maxBytes);
  try {
    const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as T;
  } catch { throw new HttpError(400, 'Geçersiz JSON gövdesi.'); }
}

export function validImage(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n);
  const text = new TextDecoder('latin1').decode(bytes.slice(0, 32));
  if (mime === 'image/webp') return text.startsWith('RIFF') && text.slice(8,12) === 'WEBP';
  if (mime === 'image/heic' || mime === 'image/heif') return text.slice(4,8) === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1/.test(text.slice(8));
  return false;
}

export function validStorageKey(key: unknown, uid?: string): key is string {
  return typeof key === 'string' && /^(wardrobe|gallery|avatars)\/[A-Za-z0-9_-]{1,128}\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif)$/.test(key)
    && (!uid || key.split('/')[1] === uid);
}

// Zero-width, bidi-control and BOM characters can hide or reorder text.
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Single-line text that may reach a model prompt or be stored: no control / invisible chars, collapsed whitespace. */
export function cleanText(value: string): string {
  return value.replace(INVISIBLE, '').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
}
/** Free text (e.g. a chat message): strips control and invisible characters but keeps line breaks. */
export function cleanMessage(value: string): string {
  return value.replace(INVISIBLE, '').replace(CONTROL, '').trim();
}

export const MIME_EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
const EXTENSION_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };

/** The stored extension always comes from the validated MIME type. A recognised filename extension that disagrees is rejected. */
export function extensionFor(fileName: string, mimeType: string): string {
  const extension = MIME_EXTENSION[mimeType];
  if (!extension) throw new HttpError(415, 'Fotoğraf biçimi desteklenmiyor. JPEG, PNG, WebP veya HEIC seç.');
  const fromName = fileName.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
  const claimed = fromName ? EXTENSION_MIME[fromName] : undefined;
  const heif = (value: string) => value === 'image/heic' || value === 'image/heif';
  if (claimed && claimed !== mimeType && !(heif(claimed) && heif(mimeType))) throw new HttpError(415, 'Dosya uzantısı fotoğraf biçimiyle eşleşmiyor.');
  return extension;
}

/** Removes APP1 (EXIF / XMP) segments from a JPEG by walking the marker segments. No dependencies. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const bad = () => new HttpError(415, 'JPEG dosyası okunamadı veya bozuk.');
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw bad();
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw bad();
    while (bytes[offset] === 0xff && offset < bytes.length) offset++; // fill bytes
    const marker = bytes[offset++];
    if (marker === undefined) throw bad();
    if (marker === 0xd9) { parts.push(Uint8Array.of(0xff, 0xd9)); offset = bytes.length; break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { parts.push(Uint8Array.of(0xff, marker)); continue; }
    if (offset + 2 > bytes.length) throw bad();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw bad();
    if (marker === 0xda) { parts.push(bytes.subarray(offset - 2)); offset = bytes.length; break; } // entropy-coded data follows verbatim
    if (marker !== 0xe1) parts.push(bytes.subarray(offset - 2, offset + length));
    offset += length;
  }
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) { result.set(part, position); position += part.length; }
  return result;
}
