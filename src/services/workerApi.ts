import { firebaseAuth } from '../config/firebase';
import { WORKER_URL } from '../config/env';
import * as FileSystem from 'expo-file-system/legacy';

export type RateLimitReason = 'cooldown' | 'daily' | 'budget' | 'storage' | 'media';

export class RateLimitError extends Error {
  readonly reason: RateLimitReason;
  readonly waitSeconds: number;
  constructor(reason: RateLimitReason, message: string, waitSeconds = 0) {
    super(message);
    this.name = 'RateLimitError';
    this.reason = reason;
    this.waitSeconds = waitSeconds;
  }
}

export class ProRequiredError extends Error { constructor(message: string) { super(message); this.name = 'ProRequiredError'; } }

type ErrorBody = { error?: string; code?: string; waitSeconds?: number };

// Firebase App Check: a native integration registers a provider once at startup; without one no header is sent.
type AppCheckTokenProvider = () => Promise<string | null>;
let appCheckTokenProvider: AppCheckTokenProvider | null = null;
export function setAppCheckTokenProvider(provider: AppCheckTokenProvider | null): void { appCheckTokenProvider = provider; }
async function appCheckHeaders(): Promise<Record<string, string>> {
  if (!appCheckTokenProvider) return {};
  try {
    const token = await appCheckTokenProvider();
    return token ? { 'X-Firebase-AppCheck': token } : {};
  } catch { return {}; } // App Check must never block a request on its own; the Worker decides.
}

const RATE_LIMIT_CODES = ['daily', 'cooldown', 'budget', 'storage', 'media'];
/** Shared error mapping for JSON and multipart responses. */
function throwWorkerError(status: number, payload: ErrorBody | null | undefined): never {
  if (['pro_required', 'trial_exhausted', 'wardrobe_limit'].includes(payload?.code ?? '')) throw new ProRequiredError(payload?.error ?? 'Bu özellik Ne Giysem Pro gerektiriyor.');
  if (status === 429 && RATE_LIMIT_CODES.includes(payload?.code ?? '')) {
    throw new RateLimitError(payload!.code as RateLimitReason, payload?.error ?? 'API kullanım sınırına ulaşıldı.', payload?.waitSeconds ?? 0);
  }
  if (status === 429) throw new RateLimitError('cooldown', payload?.error ?? 'Çok fazla istek gönderdin. Biraz sonra yeniden dene.', payload?.waitSeconds ?? 0);
  throw new Error(payload?.error ?? `Sunucu isteği başarısız oldu (HTTP ${status}). Lütfen tekrar dene.`);
}

function endpoint(path: string): string {
  const root = WORKER_URL.replace(/\/$/, '');
  if (!root || !/^https:\/\//i.test(root)) throw new Error('Worker URL yapılandırması eksik veya geçersiz.');
  const parsed = new URL(root);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || !/^\/[a-z-]+$/.test(path)) throw new Error('API adresi geçersiz.');
  return `${root}${path}`;
}

async function authenticatedFetch(userId: string, path: string, body: unknown, signal: AbortSignal | undefined, forceRefresh: boolean): Promise<Response> {
  const user = firebaseAuth.currentUser;
  if (!user || user.uid !== userId) throw new Error('Oturum açılmadı.');
  const token = await user.getIdToken(forceRefresh);
  if (firebaseAuth.currentUser?.uid !== userId) throw new Error('Oturum değişti.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 40_000);
  try {
    return await fetch(endpoint(path), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(await appCheckHeaders()) }, body: JSON.stringify(body), signal: controller.signal });
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }

}

export type NativeUploadFile = { uri: string; type: string };

async function authenticatedUpload(userId: string, path: string, file: NativeUploadFile, folder: string, forceRefresh: boolean): Promise<FileSystem.FileSystemUploadResult> {
  const user = firebaseAuth.currentUser;
  if (!user || user.uid !== userId) throw new Error('Oturum açılmadı.');
  const token = await user.getIdToken(forceRefresh);
  if (firebaseAuth.currentUser?.uid !== userId) throw new Error('Oturum değişti.');
  const task = FileSystem.createUploadTask(endpoint(path), file.uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    mimeType: file.type,
    parameters: { folder },
    headers: { Authorization: `Bearer ${token}`, ...(await appCheckHeaders()) },
  });
  const timer = setTimeout(() => { void task.cancelAsync().catch(() => undefined); }, 60_000);
  try { const result = await task.uploadAsync(); if (!result) throw new Error('Fotoğraf yükleme iptal edildi veya zaman aşımına uğradı.'); return result; }
  finally { clearTimeout(timer); }
}

async function readResponse<T>(result: Response): Promise<T> {
  const payload = await result.json().catch(() => null) as (T & ErrorBody) | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    // Non-JSON bodies (gateway HTML, empty 5xx...) still report the HTTP status.
    if (!result.ok) throw new Error(`Sunucu geçici olarak yanıt vermedi (HTTP ${result.status}). Lütfen tekrar dene.`);
    throw new Error('Sunucu geçersiz bir yanıt gönderdi.');
  }
  if (!result.ok) throwWorkerError(result.status, payload);
  return payload;
}

export async function workerPost<T>(userId: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (!userId || firebaseAuth.currentUser?.uid !== userId) throw new Error('Oturum doğrulanamadı.');
  let result = await authenticatedFetch(userId, path, body, signal, false);
  // Retrying on 401 is safe for every route: the Worker authenticates BEFORE any side effect, so a 401 proves the
  // request was not processed and resending it with a refreshed token cannot duplicate a non-idempotent POST.
  if (result.status === 401) result = await authenticatedFetch(userId, path, body, signal, true);
  if (firebaseAuth.currentUser?.uid !== userId) throw new Error('Oturum değişti.');
  return readResponse<T>(result);
}

export async function workerUpload<T>(userId: string, path: string, file: NativeUploadFile, folder: string): Promise<T> {
  if (!userId || firebaseAuth.currentUser?.uid !== userId) throw new Error('Oturum doğrulanamadı.');
  try {
    let result = await authenticatedUpload(userId, path, file, folder, false);
    if (result.status === 401) result = await authenticatedUpload(userId, path, file, folder, true);
    let payload: (T & ErrorBody) | undefined;
    try { payload = JSON.parse(result.body) as T & ErrorBody; } catch { /* Malformed response is reported below. */ }
    if (result.status < 200 || result.status >= 300) {
      if (!payload) throw new Error(`Sunucu fotoğrafı reddetti (HTTP ${result.status}).`);
      throwWorkerError(result.status, payload);
    }
    if (!payload) throw new Error('Sunucu geçersiz bir yükleme yanıtı gönderdi.');
    if (firebaseAuth.currentUser?.uid !== userId) throw new Error('Oturum değişti.');
    return payload;
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof ProRequiredError) throw error;
    if (error instanceof Error && !/Network request failed|Failed to fetch|network connection/i.test(error.message)) throw error;
    throw new Error('Fotoğraf sunucuya gönderilemedi. İnternet bağlantını kontrol edip tekrar dene.');
  }
}
