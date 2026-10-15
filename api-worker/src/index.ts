import type { BillingEnv } from './subscriptions';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { RateLimiter } from './rateLimiter';
import { revokeApple, type AppleEnv } from './apple';
import { deleteAccountChunk, adminToken } from './accountDeletion';
import { CostGuard, type CostEnv } from './costGuard';
import { HttpError, boundedBody, inputJson, validImage, validStorageKey } from './security';
import { completeOutfit, type ClothingSummary } from './outfitRules';

export { RateLimiter, CostGuard };

export interface Env extends CostEnv, AppleEnv, BillingEnv {
  FIREBASE_WEB_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT?: string;
  COST_GUARD: DurableObjectNamespace;
  OPENAI_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
  RATE_LIMITER: DurableObjectNamespace;
  IMAGES: R2Bucket;
}

type AuthUser = { uid: string; authTime: number; appleSubject?: string };
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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const VISION_PROMPT = 'Sen bir moda asistanısın. Fotoğraftaki tek parçayı etiketle. tur, hakim renk, ikincil renkler, desen, kesim (dar/normal/bol/bilinmiyor), altTur (tişört/gömlek/kazak/pantolon/etek/ceket/kaban/ayakkabı/çanta/kemer/diğer), kemerUygun, uygun mevsimler, kısa stil etiketleri, resmiyet (günlük/smart casual/resmi/bilinmiyor) ve materialGuess alanlarını doldur. Kesim veya malzeme görselden ayırt edilemiyorsa bilinmiyor de; malzemeyi kesin gerçek gibi sunma. Çanta ve kemeri aksesuar türünde doğru altTur ile ayır. KemerUygun yalnızca belinde kemer kullanılabilecek alt giyim için doğru olsun. Sadece JSON dön.';
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
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return {
    ...(origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

function response(request: Request, env: Env, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(request, env) });
}

async function authenticate(request: Request, env: Env): Promise<AuthUser> {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_WEB_API_KEY) throw new HttpError(503, 'Oturum servisi henüz hazır değil.');
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 8192) throw new HttpError(401, 'Oturum doğrulanamadı.');
  const token = authorization.slice(7);
  let payload;
  try {
    ({ payload } = await jwtVerify(token, FIREBASE_JWKS, {
      algorithms: ['RS256'], audience: env.FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      requiredClaims: ['sub', 'iat', 'exp', 'auth_time'],
    }));
  } catch { throw new HttpError(401, 'Oturum doğrulanamadı.'); }
  if (typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub)
    || typeof payload.auth_time !== 'number' || payload.auth_time > Date.now() / 1000 + 30) throw new HttpError(401, 'Oturum doğrulanamadı.');
  if (payload.email_verified !== true) throw new HttpError(403, 'Önce e-posta adresini doğrulamalısın.', 'email_unverified');
  // Signature-only checks leave deleted/disabled/revoked accounts usable until token expiry.
  let lookup: Response;
  try {
    lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(8000),
    });
  } catch { throw new HttpError(503, 'Oturum kontrolü tamamlanamadı. Lütfen tekrar dene.'); }
  if (!lookup.ok) throw new HttpError(lookup.status >= 500 || lookup.status === 429 ? 503 : 401, 'Oturum doğrulanamadı.');
  const account = (await lookup.json<{ users?: Array<{ localId?: string; disabled?: boolean; emailVerified?: boolean; validSince?: string }> }>()).users?.[0];
  if (!account || account.localId !== payload.sub || account.disabled || account.emailVerified !== true
    || (account.validSince && (!Number.isFinite(Number(account.validSince)) || payload.auth_time < Number(account.validSince)))) throw new HttpError(401, 'Oturumun sona erdi. Yeniden giriş yap.');
  const firebase = payload.firebase as { identities?: Record<string, unknown> } | undefined;
  const appleIds = firebase?.identities?.['apple.com'];
  return { uid: payload.sub, authTime: payload.auth_time, appleSubject: Array.isArray(appleIds) && typeof appleIds[0] === 'string' ? appleIds[0] : undefined };
}

async function consumeBudget(env: Env, kind: 'ai' | 'upload' | 'media', bytes?: number): Promise<void> {
  if (!env.COST_GUARD) throw new HttpError(503, 'Kullanım kontrolü hazır değil.');
  const stub = env.COST_GUARD.get(env.COST_GUARD.idFromName('global-budget-v1'));
  const result = await stub.fetch('https://budget/consume', { method: 'POST', body: JSON.stringify({ kind, bytes }) });
  if (!result.ok) {
    const data = await result.json<{ code?: string }>().catch(() => ({} as { code?: string }));
    throw new HttpError(result.status === 429 ? 429 : 503,
      data.code === 'ai_disabled' ? 'Yapay zeka özelliği şu anda kapalı. Kıyafetlerini elle etiketleyebilirsin.' : 'Hizmetin kullanım sınırına ulaşıldı. Lütfen daha sonra tekrar dene.', data.code ?? 'budget');
  }
}

function extensionFor(fileName: string, mimeType: string): string {
  const fromName = fileName.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
  if (fromName && /^(jpe?g|png|webp|heic|heif)$/.test(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  return mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
}

function mediaUrl(request: Request, key: string, accessToken: string): string {
  return `${new URL(request.url).origin}/media/${key.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(accessToken)}`;
}

async function reserve(env: Env, uid: string, feature: 'analysis' | 'chat'): Promise<string> {
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(uid));
  const result = await stub.fetch('https://rate-limit/reserve', { method: 'POST', body: JSON.stringify({ uid, feature }) });
  const body = await result.json() as { requestId?: string; code?: string; waitSeconds?: number; error?: string };
  if (!result.ok || !body.requestId) {
    const message = body.code === 'daily'
      ? 'Günlük ilham limitine ulaştın. Kendi yaratıcılığını konuşturma vakti, yarın tekrar görüşürüz!'
      : 'Biraz yavaşlayalım! Stil danışmanın düşünüyor, lütfen birkaç saniye bekle.';
    throw new HttpError(result.status, body.error ?? message, body.code, body.waitSeconds);
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
    signal: AbortSignal.timeout(25_000),
  });
  if (!result.ok) {
    const failure = await result.json<OpenAIErrorResponse>().catch((): OpenAIErrorResponse => ({}));
    const code = failure.error?.code ?? failure.error?.type;
    console.error('OpenAI request failed', { status: result.status, code });
    if (result.status === 401) throw new HttpError(502, 'Stil servisi şu anda kullanılamıyor.');
    if (result.status === 429) throw new HttpError(502, 'Stil servisi kullanım sınırına ulaştı. Lütfen daha sonra dene.');
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

function parseTags(content: string): { tur: string; renk: string; desen: string; kesim: string; altTur: string; kemerUygun: boolean; secondaryColors: string[]; season: string[]; styleTags: string[]; formality: string; materialGuess: string } {
  const value = JSON.parse(content) as { tur?: unknown; renk?: unknown; desen?: unknown; kesim?: unknown; altTur?: unknown; kemerUygun?: unknown; secondaryColors?: unknown; season?: unknown; styleTags?: unknown; formality?: unknown; materialGuess?: unknown };
  const strings = (input: unknown, max: number) => Array.isArray(input) && input.length <= max && input.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 40);
  if (!value || !['üst', 'alt', 'dış giyim', 'ayakkabı', 'aksesuar'].includes(String(value.tur)) || typeof value.renk !== 'string' || !value.renk.trim() || typeof value.desen !== 'string' || !value.desen.trim() || !['dar', 'normal', 'bol', 'bilinmiyor'].includes(String(value.kesim)) || !['tişört', 'gömlek', 'kazak', 'pantolon', 'etek', 'ceket', 'kaban', 'ayakkabı', 'çanta', 'kemer', 'diğer'].includes(String(value.altTur)) || typeof value.kemerUygun !== 'boolean') {
    throw new HttpError(502, 'Stil servisi geçersiz etiketler üretti.');
  }
  if (!strings(value.secondaryColors, 4) || !strings(value.season, 4) || !strings(value.styleTags, 8) || !['günlük','smart casual','resmi','bilinmiyor'].includes(String(value.formality)) || typeof value.materialGuess !== 'string' || !value.materialGuess.trim() || value.materialGuess.length > 80) throw new HttpError(502, 'Stil servisi geçersiz ek etiketler üretti.');
  return { tur: String(value.tur), renk: value.renk.trim().slice(0, 80), desen: value.desen.trim().slice(0, 80), kesim: String(value.kesim), altTur: String(value.altTur), kemerUygun: value.kemerUygun, secondaryColors: value.secondaryColors as string[], season: value.season as string[], styleTags: value.styleTags as string[], formality: String(value.formality), materialGuess: value.materialGuess.trim() };
}

function parseRecommendation(content: string, wardrobe: ClothingSummary[], replacement: boolean): { mesaj: string; secilen_idler: string[] } {
  const value = JSON.parse(content) as { mesaj?: unknown; secilen_idler?: unknown };
  const knownIds = new Set(wardrobe.map((item) => item.id));
  if (!value || typeof value.mesaj !== 'string' || !value.mesaj.trim() || !Array.isArray(value.secilen_idler) || value.secilen_idler.length < 1 || value.secilen_idler.length > 12 || !value.secilen_idler.every((id) => typeof id === 'string' && knownIds.has(id)) || new Set(value.secilen_idler).size !== value.secilen_idler.length) {
    throw new HttpError(502, 'Stil servisi geçersiz bir kombin üretti.');
  }
  return completeOutfit({ mesaj: value.mesaj.trim().slice(0, 500), secilen_idler: value.secilen_idler }, wardrobe, replacement);
}

async function withAiQuota<T>(env: Env, uid: string, feature: 'analysis' | 'chat', operation: () => Promise<T>): Promise<T> {
  const requestId = await reserve(env, uid, feature);
  try {
    await consumeBudget(env, 'ai');
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
    let key: string;
    try { key = url.pathname.slice('/media/'.length).split('/').map(decodeURIComponent).join('/'); }
    catch { throw new HttpError(404, 'Fotoğraf bulunamadı.'); }
    const token = url.searchParams.get('token');
    if (!validStorageKey(key) || !token || !/^[0-9a-f-]{36}$/.test(token)) throw new HttpError(404, 'Fotoğraf bulunamadı.');
    await consumeBudget(env, 'media');
    const object = await env.IMAGES.get(key);
    if (!object || object.customMetadata?.accessToken !== token) throw new HttpError(404, 'Fotoğraf bulunamadı.');
    const headers = new Headers({
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'ETag': object.httpEtag,
      'X-Content-Type-Options': 'nosniff',
    });
    return new Response(object.body, { headers });
  }
  const origin = request.headers.get('Origin');
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (origin && !allowedOrigins.includes(origin)) throw new HttpError(403, 'Origin izinli değil.');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (request.method !== 'POST') throw new HttpError(405, 'Yalnızca POST desteklenir.');
  const paths = ['/upload-image', '/delete-object', '/delete-account', '/analyze-clothing', '/generate-outfit', '/subscription-status', '/wardrobe-capacity', '/wardrobe-create'];
  if (!paths.includes(url.pathname)) throw new HttpError(404, 'İşlem bulunamadı.');
  if (['/analyze-clothing', '/generate-outfit'].includes(url.pathname) && (env.AI_ENABLED !== 'true' || !env.OPENAI_API_KEY)) throw new HttpError(503, 'Yapay zeka özelliği şu anda kapalı. Kıyafetlerini elle etiketleyebilirsin.', 'ai_disabled');
  const { uid, authTime, appleSubject } = await authenticate(request, env);

  if (url.pathname !== '/delete-account') {
    const status = await env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(uid)).fetch('https://rate-limit/status', { method: 'POST', body: '{}' });
    if (!status.ok) throw new HttpError(403, 'Hesabının silinmesi devam ediyor.');
  }

  if (url.pathname === '/subscription-status' || url.pathname === '/wardrobe-capacity' || url.pathname === '/wardrobe-create') {
    const input = await inputJson<{ force?: boolean; key?: string; tags?: unknown }>(request, 4096);
    const result = await env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(uid)).fetch(
      `https://rate-limit/${url.pathname === '/subscription-status' ? 'plan' : url.pathname.slice(1)}`,
      { method: 'POST', body: JSON.stringify({ uid, force: input.force === true, wardrobe: { key: input.key, tags: input.tags, origin: url.origin } }) },
    );
    return response(request, env, await result.json(), result.status);
  }

  if (url.pathname === '/upload-image') {
    const requestType = request.headers.get('Content-Type') ?? '';
    if (!requestType.toLowerCase().startsWith('multipart/form-data')) throw new HttpError(415, 'Sunucu formatı reddetti: multipart fotoğraf verisi bekleniyordu.');
    let form: FormData;
    try {
      const bytes = await boundedBody(request, MAX_IMAGE_BYTES + 16_384);
      form = await new Response(bytes as BodyInit, { headers: { 'Content-Type': requestType } }).formData();
    }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Fotoğraf formu okunamadı.'); }
    const folderValue = form.get('folder');
    const fileValue = form.get('file');
    if (typeof folderValue !== 'string' || !ALLOWED_FOLDERS.has(folderValue)) throw new HttpError(400, 'Yükleme hedefi geçersiz.');
    if (!(fileValue instanceof File)) throw new HttpError(400, 'Sunucu formatı reddetti: fotoğraf dosyası bulunamadı.');
    const contentType = fileValue.type.trim().toLowerCase();
    if (!ALLOWED_MIME.has(contentType)) throw new HttpError(415, 'Fotoğraf biçimi desteklenmiyor. JPEG, PNG, WebP veya HEIC seç.');
    if (fileValue.size <= 0) throw new HttpError(400, 'Seçilen fotoğraf boş veya okunamıyor.');
    if (fileValue.size > MAX_IMAGE_BYTES) throw new HttpError(413, 'Fotoğraf 5 MB sınırını aşıyor.');
    const bytes = await fileValue.arrayBuffer();
    if (bytes.byteLength !== fileValue.size) throw new HttpError(400, 'Fotoğraf aktarımı eksik tamamlandı. Lütfen tekrar dene.');
    if (!validImage(new Uint8Array(bytes), contentType)) throw new HttpError(415, 'Dosyanın içeriği fotoğraf biçimiyle eşleşmiyor.');
    const quota = await env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(uid)).fetch('https://rate-limit/upload', { method: 'POST', body: JSON.stringify({ bytes: bytes.byteLength }) });
    if (!quota.ok) throw new HttpError(429, 'Günlük fotoğraf yükleme sınırına ulaştın veya çok hızlı yüklüyorsun.', 'storage');
    await consumeBudget(env, 'upload', bytes.byteLength);
    const key = `${folderValue}/${uid}/${crypto.randomUUID()}.${extensionFor(fileValue.name, contentType)}`;
    const accessToken = crypto.randomUUID();
    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType }, customMetadata: { accessToken } });
    return response(request, env, { publicUrl: mediaUrl(request, key, accessToken), key });
  }

  if (url.pathname === '/delete-object') {
    const input = await inputJson<{ key?: string }>(request);
    if (!validStorageKey(input.key, uid)) throw new HttpError(403, 'Bu dosyayı silme yetkin yok.');
    await env.IMAGES.delete(input.key);
    return response(request, env, { ok: true });
  }

  if (url.pathname === '/delete-account') {
    if (Date.now() / 1000 - authTime > 300) throw new HttpError(401, 'Hesabını silmek için yeniden giriş yapmalısın.');
    const input = await inputJson<{ appleAuthorizationCode?: string }>(request, 8192);
    const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(uid));
    // Close paid API access before cleanup; this remains set through retries.
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new HttpError(503, 'Hesap silme servisi henüz yapılandırılmadı. Verilerin değiştirilmedi.');
    await adminToken(env);
    if (appleSubject) {
      const status = await limiter.fetch('https://rate-limit/apple-status', { method: 'POST', body: JSON.stringify({ authTime }) });
      if (!status.ok) {
        if (typeof input.appleAuthorizationCode !== 'string' || input.appleAuthorizationCode.length > 4096) throw new HttpError(400, 'Apple ile yeniden giriş yapmalısın.');
        await revokeApple(env, input.appleAuthorizationCode, appleSubject);
        await limiter.fetch('https://rate-limit/apple-revoked', { method: 'POST', body: JSON.stringify({ authTime }) });
      }
    }
    await limiter.fetch('https://rate-limit/deleting', { method: 'POST', body: '{}' });
    const result = await deleteAccountChunk(env, uid, request.headers.get('Authorization')!.slice(7));
    if (result.done) {
      if (env.REVENUECAT_SECRET_KEY) {
        const removed = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${env.REVENUECAT_SECRET_KEY}` }, signal: AbortSignal.timeout(8000) }).catch(() => null);
        if (removed && !removed.ok && removed.status !== 404) console.error('RevenueCat subscriber cleanup failed', { status: removed.status });
      }
      // Retain only the deletion lock / Apple revocation marker; clear plan and usage metadata.
      await limiter.fetch('https://rate-limit/purge-personal', { method: 'POST', body: '{}' });
    }
    return response(request, env, result);
  }

  if (url.pathname === '/analyze-clothing') {
    const input = await inputJson<{ imageBase64?: string; mimeType?: string; aiConsent?: boolean }>(request, 1_500_000);
    if (input.aiConsent !== true) throw new HttpError(403, 'OpenAI ile veri paylaşımı için onayın gerekiyor.', 'consent_required');
    if (typeof input.imageBase64 !== 'string' || !input.imageBase64 || input.imageBase64.length > 1_400_000 || (input.imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.imageBase64)) || input.mimeType !== 'image/jpeg') throw new HttpError(400, 'Görsel verisi geçersiz.');
    if (!validImage(Uint8Array.from(atob(input.imageBase64.slice(0, 32)), (c) => c.charCodeAt(0)), input.mimeType)) throw new HttpError(400, 'Fotoğraf verisi geçersiz.');
    const tags = await withAiQuota(env, uid, 'analysis', async () => {
      const result = await openAI(env, {
        model: MODEL,
        service_tier: 'default',
        reasoning: { effort: 'none' },
        max_output_tokens: 300,
        store: false,
        input: [
          { role: 'system', content: VISION_PROMPT },
          { role: 'user', content: [{ type: 'input_text', text: 'Fotoğraftaki kıyafeti analiz et.' }, { type: 'input_image', image_url: `data:${input.mimeType};base64,${input.imageBase64}`, detail: 'low' }] },
        ],
        text: { format: { type: 'json_schema', name: 'clothing_tags', strict: true, schema: { type: 'object', properties: { tur: { type: 'string', enum: ['üst', 'alt', 'dış giyim', 'ayakkabı', 'aksesuar'] }, renk: { type: 'string' }, secondaryColors: { type: 'array', maxItems: 4, items: { type: 'string' } }, desen: { type: 'string' }, kesim: { type: 'string', enum: ['dar', 'normal', 'bol', 'bilinmiyor'] }, altTur: { type: 'string', enum: ['tişört', 'gömlek', 'kazak', 'pantolon', 'etek', 'ceket', 'kaban', 'ayakkabı', 'çanta', 'kemer', 'diğer'] }, kemerUygun: { type: 'boolean' }, season: { type: 'array', maxItems: 4, items: { type: 'string' } }, styleTags: { type: 'array', maxItems: 8, items: { type: 'string' } }, formality: { type: 'string', enum: ['günlük','smart casual','resmi','bilinmiyor'] }, materialGuess: { type: 'string' } }, required: ['tur', 'renk', 'secondaryColors', 'desen', 'kesim', 'altTur', 'kemerUygun', 'season', 'styleTags', 'formality', 'materialGuess'], additionalProperties: false } } },
      });
      return parseTags(completionContent(result));
    });
    return response(request, env, { tags });
  }

  if (url.pathname === '/generate-outfit') {
    const input = await inputJson<{ wardrobe?: ClothingSummary[]; message?: string; aiConsent?: boolean }>(request);
    if (input.aiConsent !== true) throw new HttpError(403, 'OpenAI ile veri paylaşımı için onayın gerekiyor.', 'consent_required');
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    if (!Array.isArray(input.wardrobe) || input.wardrobe.length < 2 || input.wardrobe.length > 100 || !message || message.length > 1200) throw new HttpError(400, 'Kombin isteği geçersiz.');
    if (!input.wardrobe.every((item) => item && typeof item === 'object')) throw new HttpError(400, 'Gardırop özeti geçersiz.');
    const wardrobe = input.wardrobe.map((item) => ({ id: item.id, tur: item.tur, renk: item.renk, desen: item.desen, son_kullanim: item.son_kullanim, kullanim_sayisi: item.kullanim_sayisi, kesim: item.kesim ?? 'bilinmiyor', alt_tur: item.alt_tur ?? 'diğer', kemer_uygun: item.kemer_uygun ?? false, mevsim: item.mevsim ?? [], stil: item.stil ?? [], resmiyet: item.resmiyet ?? 'bilinmiyor', malzeme_tahmini: item.malzeme_tahmini ?? 'bilinmiyor' }));
    const valid = wardrobe.every((item) => item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128 && ['üst', 'alt', 'dış giyim', 'ayakkabı', 'aksesuar'].includes(item.tur) && typeof item.renk === 'string' && item.renk.length <= 80 && typeof item.desen === 'string' && item.desen.length <= 80 && ['dar', 'normal', 'bol', 'bilinmiyor'].includes(item.kesim) && typeof item.alt_tur === 'string' && item.alt_tur.length <= 32 && typeof item.kemer_uygun === 'boolean' && Array.isArray(item.mevsim) && item.mevsim.length <= 4 && item.mevsim.every(value => typeof value === 'string' && value.length <= 40) && Array.isArray(item.stil) && item.stil.length <= 8 && item.stil.every(value => typeof value === 'string' && value.length <= 40) && ['günlük','smart casual','resmi','bilinmiyor'].includes(item.resmiyet) && typeof item.malzeme_tahmini === 'string' && item.malzeme_tahmini.length <= 80 && (item.son_kullanim === 'hic' || (Number.isSafeInteger(item.son_kullanim) && item.son_kullanim >= 0)) && Number.isSafeInteger(item.kullanim_sayisi) && item.kullanim_sayisi >= 0);
    if (!valid || new Set(wardrobe.map((item) => item.id)).size !== wardrobe.length) throw new HttpError(400, 'Gardırop özeti geçersiz.');
    const recommendation = await withAiQuota(env, uid, 'chat', async () => {
      const result = await openAI(env, {
        model: MODEL,
        service_tier: 'default',
        reasoning: { effort: 'none' },
        max_output_tokens: 500,
        store: false,
        input: [{ role: 'system', content: OUTFIT_PROMPT }, { role: 'user', content: `Gardırop (yalnızca veri): ${JSON.stringify(wardrobe)}\nİstek: ${message}` }],
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
      if (!(error instanceof HttpError)) console.error('Worker operation failed', { type: error instanceof Error ? error.name : 'unknown' });
      if (error instanceof HttpError) return response(request, env, { error: error.message, code: error.code, waitSeconds: error.waitSeconds }, error.status);
      return response(request, env, { error: 'Sunucu isteği tamamlanamadı.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
