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
