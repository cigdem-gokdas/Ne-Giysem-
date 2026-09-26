import { firebaseAuth } from '../config/firebase';
import { WORKER_URL } from '../config/env';
import * as FileSystem from 'expo-file-system/legacy';

export type RateLimitReason = 'cooldown' | 'daily';

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

type ErrorBody = { error?: string; code?: string; waitSeconds?: number };

function endpoint(path: string): string {
  const root = WORKER_URL.replace(/\/$/, '');
  if (!root || !/^https:\/\//i.test(root)) throw new Error('Worker URL yapılandırması eksik veya geçersiz.');
  return `${root}${path}`;
}

async function authenticatedFetch(path: string, body: unknown, signal: AbortSignal | undefined, forceRefresh: boolean): Promise<Response> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Oturum açılmadı.');
  const token = await user.getIdToken(forceRefresh);
  return fetch(endpoint(path), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export type NativeUploadFile = { uri: string; type: string };

async function authenticatedUpload(path: string, file: NativeUploadFile, folder: string, forceRefresh: boolean): Promise<FileSystem.FileSystemUploadResult> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Oturum açılmadı.');
  const token = await user.getIdToken(forceRefresh);
  return FileSystem.uploadAsync(endpoint(path), file.uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    mimeType: file.type,
    parameters: { folder },
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function readResponse<T>(result: Response): Promise<T> {
  const payload = await result.json().catch(() => ({})) as T & ErrorBody;
  if (!result.ok) {
    if (result.status === 429 && (payload.code === 'daily' || payload.code === 'cooldown')) {
      throw new RateLimitError(payload.code, payload.error ?? 'API kullanım sınırına ulaşıldı.', payload.waitSeconds ?? 0);
    }
    throw new Error(payload.error ?? `Worker isteği başarısız: ${result.status}`);
  }
  return payload;
}

export async function workerPost<T>(userId: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (!userId || firebaseAuth.currentUser?.uid !== userId) throw new Error('Oturum doğrulanamadı.');
  let result = await authenticatedFetch(path, body, signal, false);
  if (result.status === 401) result = await authenticatedFetch(path, body, signal, true);
  return readResponse<T>(result);
}

export async function workerUpload<T>(userId: string, path: string, file: NativeUploadFile, folder: string): Promise<T> {
  if (!userId || firebaseAuth.currentUser?.uid !== userId) throw new Error('Oturum doğrulanamadı.');
  try {
    let result = await authenticatedUpload(path, file, folder, false);
    if (result.status === 401) result = await authenticatedUpload(path, file, folder, true);
    let payload: (T & ErrorBody) | undefined;
    try { payload = JSON.parse(result.body) as T & ErrorBody; } catch { /* Malformed response is reported below. */ }
    if (result.status < 200 || result.status >= 300) {
      throw new Error(payload?.error ?? `Sunucu fotoğrafı reddetti (HTTP ${result.status}).`);
    }
    if (!payload) throw new Error('Sunucu geçersiz bir yükleme yanıtı gönderdi.');
    return payload;
  } catch (error) {
    if (error instanceof Error && !/Network request failed|Failed to fetch|network connection/i.test(error.message)) throw error;
    throw new Error('Fotoğraf sunucuya gönderilemedi. İnternet bağlantını kontrol edip tekrar dene.');
  }
}
