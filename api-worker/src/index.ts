import { createRemoteJWKSet, jwtVerify } from 'jose';
import { RateLimiter } from './rateLimiter';
import { completeOutfit, type ClothingSummary } from './outfitRules';

export { RateLimiter };

interface Env {
  OPENAI_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
  RATE_LIMITER: DurableObjectNamespace;
  IMAGES: R2Bucket;
}

type AuthUser = { uid: string };
type OpenAIResponse = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
};
type OpenAIErrorResponse = { error?: { code?: string; message?: string; type?: string } };

const MODEL = 'gpt-6-luna';
const FIREBASE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const ALLOWED_FOLDERS = new Set(['wardrobe', 'gallery', 'avatars']);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const VISION_PROMPT = 'Sen bir moda asistanısın. Fotoğraftaki tek parçayı etiketle. tur, hakim renk, desen, kesim (dar/normal/bol/bilinmiyor), altTur (tişört/gömlek/kazak/pantolon/etek/ceket/kaban/ayakkabı/çanta/kemer/diğer) ve kemerUygun alanlarını doldur. Kesimi görselden ayırt edemiyorsan bilinmiyor de; çanta ve kemeri aksesuar türünde doğru altTur ile ayır. KemerUygun yalnızca belinde kemer kullanılabilecek alt giyim için doğru olsun. Sadece JSON dön.';
const OUTFIT_PROMPT = `Sen samimi, Türkçe konuşan, Dark Academia ve Koyu Kış (Deep Winter) estetiğinde uzman bir stil danışmanısın. Kullanıcının planına göre verilen gardırop ID'lerinden baştan aşağı uyumlu bir kombin seç. ID'ler yalnızca gerçek gardırop parçalarına ait olabilir; dışarıdan önerileri mesajda açıkça belirt.
1. Gardıroptaki farklı parçaları kullan. Peş peşe aynı alt-üst veya ayakkabı eşleşmesini ASLA önerme. Sana gönderilen liste bu rotasyona göre filtrelenmiştir; yalnızca listedeki ID'leri seç.
2. "son_kullanim" kaç kombin önce kullanıldığını, "hic" hiç kullanılmadığını gösterir. "kullanim_sayisi" düşük olan nadir kullanılmış parçaları önceliklendir. Uyumlu seçenekler arasında daima daha az kullanılanı seç.
3. Ana kıyafet son 5 kombin içinde kullanılmışsa onu seçme. Değişim isteğinde aynen korunacağı açıkça belirtilen ID'ler bu kuraldan muaftır.
4. KESİN ORANTI KURALI: Bol pantolon + bol ceket + bol tişört gibi baştan aşağı oversize kombin ASLA kurma. Alt giyim bol/geniş paça/flare ise üst giyim dar veya vücuda oturan olmalı; üst bol ise alt dar/oturan olmalı. Kesimi bilinmiyor olan parçayı dar kabul etme. Renk kadar silüet dengesini de gözet.
5. KESİN TAMAMLAMA KURALI: Her görünümde dış giyim, ayakkabı ve çanta istisnasız bulunmalı. Gardıropta varsa gerçek ID'lerini seç; yoksa hayali ID üretmeden mesajda Dark Academia'ya uygun dışarıdan parça öner. Çanta ve kemer için alt_tur etiketini kullan; aksesuar türündeki her şeyi çanta sanma.
6. Seçilen alt giyimde kemer_uygun true ise renk uyumlu bir kemer ekle. Gardıropta yoksa mesajda dışarıdan kemer öner.
7. Koyu Kış paletinde bordo, lacivert, zümrüt yeşili, siyah ve vintage dokulara öncelik ver. Blok topuklu Mary Jane'ler, yapılı ceketler ve orantılı geniş paça pantolonları kullan.
Cevabını yalnızca {"mesaj":"1-2 cümlelik Türkçe yorum","secilen_idler":["id"]} biçiminde saf JSON olarak dön.`;

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  return {
    ...(origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function response(request: Request, env: Env, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(request, env) });
}

async function authenticate(request: Request, env: Env): Promise<AuthUser> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'Oturum doğrulanamadı.');
  const token = authorization.slice(7);
  try {
    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      algorithms: ['RS256'],
      audience: env.FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
    });
    if (!payload.sub) throw new Error('Missing subject');
    return { uid: payload.sub };
  } catch {
    throw new HttpError(401, 'Oturum doğrulanamadı.');
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly waitSeconds?: number) { super(message); }
}

function extensionFor(fileName: string, mimeType: string): string {
  const fromName = fileName.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
  if (fromName && /^(jpe?g|png|webp|heic|heif)$/.test(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  return mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
}

function mediaUrl(request: Request, key: string, accessToken: string): string {
  return `${new URL(request.url).origin}/media/${key.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(accessToken)}`;
}

async function inputJson<T>(request: Request): Promise<T> {
  try { return await request.json() as T; }
  catch { throw new HttpError(400, 'Geçersiz JSON gövdesi.'); }
}

async function reserve(env: Env, uid: string): Promise<string> {
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(uid));
  const result = await stub.fetch('https://rate-limit/reserve', { method: 'POST', body: '{}' });
  const body = await result.json() as { requestId?: string; code?: string; waitSeconds?: number };
  if (!result.ok || !body.requestId) {
    const message = body.code === 'daily'
      ? 'Günlük ilham limitine ulaştın. Kendi yaratıcılığını konuşturma vakti, yarın tekrar görüşürüz!'
      : 'Biraz yavaşlayalım! Stil danışmanın düşünüyor, lütfen birkaç saniye bekle.';
    throw new HttpError(429, message, body.code, body.waitSeconds);
  }
  return body.requestId;
}

async function finishReservation(env: Env, uid: string, requestId: string, success: boolean): Promise<void> {
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(uid));
  await stub.fetch(`https://rate-limit/${success ? 'success' : 'failure'}`, { method: 'POST', body: JSON.stringify({ requestId }) });
}

async function openAI(env: Env, body: unknown): Promise<OpenAIResponse> {
  const result = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    const failure = await result.json<OpenAIErrorResponse>().catch((): OpenAIErrorResponse => ({}));
    const code = failure.error?.code ?? failure.error?.type;
    console.error('OpenAI request failed', { status: result.status, code, message: failure.error?.message });
    if (result.status === 401) throw new HttpError(502, 'Yapay zeka servis anahtarı geçersiz veya eksik.');
    if (result.status === 429) throw new HttpError(502, 'Yapay zeka servis kotası doldu. Lütfen hesap bakiyesini kontrol et.');
    if (code === 'model_not_found') throw new HttpError(502, 'Yapay zeka modeli bu hesapta kullanılamıyor.');
    throw new HttpError(502, 'Stil servisi şu anda yanıt veremiyor.');
  }
  return result.json<OpenAIResponse>();
}

function completionContent(result: OpenAIResponse): string {
  if (result.status !== 'completed') {
    console.error('OpenAI response incomplete', { status: result.status, reason: result.incomplete_details?.reason });
    throw new HttpError(502, 'Stil servisi tamamlanmış bir yanıt üretmedi.');
  }
  const content = result.output?.flatMap((item) => item.content ?? []) ?? [];
  if (content.some((item) => item.type === 'refusal' || item.refusal)) throw new HttpError(502, 'Görsel güvenlik nedeniyle analiz edilemedi.');
  const text = content.find((item) => item.type === 'output_text' && item.text)?.text;
  if (!text) throw new HttpError(502, 'Stil servisi boş bir yanıt üretti.');
  return text;
}

function parseTags(content: string): { tur: string; renk: string; desen: string; kesim: string; altTur: string; kemerUygun: boolean } {
  const value = JSON.parse(content) as { tur?: unknown; renk?: unknown; desen?: unknown; kesim?: unknown; altTur?: unknown; kemerUygun?: unknown };
  if (!value || !['üst', 'alt', 'dış giyim', 'ayakkabı', 'aksesuar'].includes(String(value.tur)) || typeof value.renk !== 'string' || !value.renk.trim() || typeof value.desen !== 'string' || !value.desen.trim() || !['dar', 'normal', 'bol', 'bilinmiyor'].includes(String(value.kesim)) || !['tişört', 'gömlek', 'kazak', 'pantolon', 'etek', 'ceket', 'kaban', 'ayakkabı', 'çanta', 'kemer', 'diğer'].includes(String(value.altTur)) || typeof value.kemerUygun !== 'boolean') {
    throw new HttpError(502, 'Stil servisi geçersiz etiketler üretti.');
  }
  return { tur: String(value.tur), renk: value.renk.trim().slice(0, 80), desen: value.desen.trim().slice(0, 80), kesim: String(value.kesim), altTur: String(value.altTur), kemerUygun: value.kemerUygun };
}

function parseRecommendation(content: string, wardrobe: ClothingSummary[], replacement: boolean): { mesaj: string; secilen_idler: string[] } {
  const value = JSON.parse(content) as { mesaj?: unknown; secilen_idler?: unknown };
  const knownIds = new Set(wardrobe.map((item) => item.id));
  if (!value || typeof value.mesaj !== 'string' || !value.mesaj.trim() || !Array.isArray(value.secilen_idler) || value.secilen_idler.length < 1 || value.secilen_idler.length > 12 || !value.secilen_idler.every((id) => typeof id === 'string' && knownIds.has(id)) || new Set(value.secilen_idler).size !== value.secilen_idler.length) {
    throw new HttpError(502, 'Stil servisi geçersiz bir kombin üretti.');
  }
  return completeOutfit({ mesaj: value.mesaj.trim().slice(0, 500), secilen_idler: value.secilen_idler }, wardrobe, replacement);
}

async function withAiQuota<T>(env: Env, uid: string, operation: () => Promise<T>): Promise<T> {
  const requestId = await reserve(env, uid);
  try {
    const result = await operation();
    await finishReservation(env, uid, requestId, true);
    return result;
  } catch (error) {
    await finishReservation(env, uid, requestId, false).catch(() => undefined);
    throw error;
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
    const key = url.pathname.slice('/media/'.length).split('/').map(decodeURIComponent).join('/');
    const token = url.searchParams.get('token');
    if (!key || !token) throw new HttpError(404, 'Fotoğraf bulunamadı.');
    const object = await env.IMAGES.get(key);
    if (!object || object.customMetadata?.accessToken !== token) throw new HttpError(404, 'Fotoğraf bulunamadı.');
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'private, max-age=86400',
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'ETag': object.httpEtag,
      'X-Content-Type-Options': 'nosniff',
    });
    return new Response(object.body, { headers });
  }
  const origin = request.headers.get('Origin');
  const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  if (origin && !allowedOrigins.includes(origin)) throw new HttpError(403, 'Origin izinli değil.');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (request.method !== 'POST') throw new HttpError(405, 'Yalnızca POST desteklenir.');
  const { uid } = await authenticate(request, env);

  if (url.pathname === '/upload-image') {
    const requestType = request.headers.get('Content-Type') ?? '';
    if (!requestType.toLowerCase().startsWith('multipart/form-data')) throw new HttpError(415, 'Sunucu formatı reddetti: multipart fotoğraf verisi bekleniyordu.');
    let form: FormData;
    try { form = await request.formData(); }
    catch { throw new HttpError(400, 'Sunucu formatı reddetti: fotoğraf formu okunamadı.'); }
    const folderValue = form.get('folder');
    const fileValue = form.get('file');
    if (typeof folderValue !== 'string' || !ALLOWED_FOLDERS.has(folderValue)) throw new HttpError(400, 'Yükleme hedefi geçersiz.');
    if (!(fileValue instanceof File)) throw new HttpError(400, 'Sunucu formatı reddetti: fotoğraf dosyası bulunamadı.');
    const contentType = fileValue.type.trim().toLowerCase();
    if (!ALLOWED_MIME.has(contentType)) throw new HttpError(415, 'Fotoğraf biçimi desteklenmiyor. JPEG, PNG, WebP veya HEIC seç.');
    if (fileValue.size <= 0) throw new HttpError(400, 'Seçilen fotoğraf boş veya okunamıyor.');
    if (fileValue.size > MAX_IMAGE_BYTES) throw new HttpError(413, 'Fotoğraf 20 MB sınırını aşıyor.');
    const bytes = await fileValue.arrayBuffer();
    if (bytes.byteLength !== fileValue.size) throw new HttpError(400, 'Fotoğraf aktarımı eksik tamamlandı. Lütfen tekrar dene.');
    const key = `${folderValue}/${uid}/${crypto.randomUUID()}.${extensionFor(fileValue.name, contentType)}`;
    const accessToken = crypto.randomUUID();
    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType }, customMetadata: { accessToken } });
    return response(request, env, { publicUrl: mediaUrl(request, key, accessToken), key });
  }

  if (url.pathname === '/delete-object') {
    const input = await inputJson<{ key?: string }>(request);
    if (!input.key || ![...ALLOWED_FOLDERS].some((folder) => input.key?.startsWith(`${folder}/${uid}/`))) throw new HttpError(403, 'Bu dosyayı silme yetkin yok.');
    await env.IMAGES.delete(input.key);
    return response(request, env, { ok: true });
  }

  if (url.pathname === '/analyze-clothing') {
    const input = await inputJson<{ imageBase64?: string; mimeType?: string }>(request);
    if (!input.imageBase64 || input.imageBase64.length > 28_000_000 || !input.mimeType || !ALLOWED_MIME.has(input.mimeType)) throw new HttpError(400, 'Görsel verisi geçersiz.');
    const tags = await withAiQuota(env, uid, async () => {
      const result = await openAI(env, {
        model: MODEL,
        reasoning: { effort: 'none' },
        max_output_tokens: 300,
        store: false,
        input: [
          { role: 'system', content: VISION_PROMPT },
          { role: 'user', content: [{ type: 'input_text', text: 'Fotoğraftaki kıyafeti analiz et.' }, { type: 'input_image', image_url: `data:${input.mimeType};base64,${input.imageBase64}`, detail: 'low' }] },
        ],
        text: { format: { type: 'json_schema', name: 'clothing_tags', strict: true, schema: { type: 'object', properties: { tur: { type: 'string', enum: ['üst', 'alt', 'dış giyim', 'ayakkabı', 'aksesuar'] }, renk: { type: 'string' }, desen: { type: 'string' }, kesim: { type: 'string', enum: ['dar', 'normal', 'bol', 'bilinmiyor'] }, altTur: { type: 'string', enum: ['tişört', 'gömlek', 'kazak', 'pantolon', 'etek', 'ceket', 'kaban', 'ayakkabı', 'çanta', 'kemer', 'diğer'] }, kemerUygun: { type: 'boolean' } }, required: ['tur', 'renk', 'desen', 'kesim', 'altTur', 'kemerUygun'], additionalProperties: false } } },
      });
      return parseTags(completionContent(result));
    });
    return response(request, env, { tags });
  }

  if (url.pathname === '/generate-outfit') {
    const input = await inputJson<{ wardrobe?: ClothingSummary[]; message?: string }>(request);
    const message = input.message?.trim();
    if (!Array.isArray(input.wardrobe) || input.wardrobe.length < 2 || input.wardrobe.length > 500 || !message || message.length > 1200) throw new HttpError(400, 'Kombin isteği geçersiz.');
    if (!input.wardrobe.every((item) => item && typeof item === 'object')) throw new HttpError(400, 'Gardırop özeti geçersiz.');
    const wardrobe = input.wardrobe.map((item) => ({ ...item, kesim: item.kesim ?? 'bilinmiyor', alt_tur: item.alt_tur ?? 'diğer', kemer_uygun: item.kemer_uygun ?? false }));
    const valid = wardrobe.every((item) => item && typeof item.id === 'string' && item.id.length <= 128 && typeof item.tur === 'string' && typeof item.renk === 'string' && ['dar', 'normal', 'bol', 'bilinmiyor'].includes(item.kesim) && typeof item.alt_tur === 'string' && typeof item.kemer_uygun === 'boolean' && (item.son_kullanim === 'hic' || (Number.isSafeInteger(item.son_kullanim) && item.son_kullanim >= 0)) && Number.isSafeInteger(item.kullanim_sayisi) && item.kullanim_sayisi >= 0);
    if (!valid) throw new HttpError(400, 'Gardırop özeti geçersiz.');
    const recommendation = await withAiQuota(env, uid, async () => {
      const result = await openAI(env, {
        model: MODEL,
        reasoning: { effort: 'none' },
        max_output_tokens: 500,
        store: false,
        input: [{ role: 'system', content: `${OUTFIT_PROMPT}\nGardırop: ${JSON.stringify(wardrobe)}` }, { role: 'user', content: message }],
        text: { format: { type: 'json_schema', name: 'outfit_recommendation', strict: true, schema: { type: 'object', properties: { mesaj: { type: 'string', minLength: 1, maxLength: 500 }, secilen_idler: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } } }, required: ['mesaj', 'secilen_idler'], additionalProperties: false } } },
      });
      return parseRecommendation(completionContent(result), wardrobe, message.includes('Değişecek ID:'));
    });
    return response(request, env, { recommendation });
  }

  throw new HttpError(404, 'Endpoint bulunamadı.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await route(request, env); }
    catch (error) {
      console.error(error instanceof Error ? error.message : 'Bilinmeyen Worker hatası');
      if (error instanceof HttpError) return response(request, env, { error: error.message, code: error.code, waitSeconds: error.waitSeconds }, error.status);
      return response(request, env, { error: 'Sunucu isteği tamamlanamadı.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
