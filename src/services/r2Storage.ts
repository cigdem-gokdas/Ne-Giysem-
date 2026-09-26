import { withUploadStatus } from './uploadStatus';
import { workerPost, workerUpload } from './workerApi';
import * as FileSystem from 'expo-file-system/legacy';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
type UploadFolder = 'wardrobe' | 'gallery' | 'avatars';
type UploadResult = { publicUrl: string; key: string };
export type ImageUploadMetadata = { fileName?: string | null; mimeType?: string | null; fileSize?: number | null };

export function extensionFor(uri: string, mime: string): string {
  const fromUri = uri.split('?')[0].match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
  if (fromUri && /^(jpe?g|png|webp|heic|heif)$/.test(fromUri)) return fromUri === 'jpeg' ? 'jpg' : fromUri;
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic' || mime === 'image/heif') return mime.split('/')[1];
  return 'jpg';
}

export function imageMimeType(uri: string, reportedMime: string): string {
  if (/^image\/(jpeg|png|webp|heic|heif)$/i.test(reportedMime)) return reportedMime.toLowerCase();
  const extension = extensionFor(uri, reportedMime);
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic' || extension === 'heif') return `image/${extension}`;
  return 'image/jpeg';
}

export async function uploadImageToR2(userId: string, folder: UploadFolder, uri: string, metadata: ImageUploadMetadata = {}): Promise<{ url: string; key: string }> {
  return withUploadStatus('Fotoğraf güvenli alana yükleniyor…', async () => {
    if (!uri || !/^(file|content|ph):/i.test(uri)) throw new Error('Seçilen fotoğrafın yerel dosya adresi geçersiz.');
    if (metadata.fileSize && metadata.fileSize > MAX_IMAGE_BYTES) throw new Error('Fotoğraf 20 MB sınırını aşıyor.');
    const contentType = imageMimeType(uri, metadata.mimeType ?? '');
    const cache = FileSystem.cacheDirectory;
    if (!cache) throw new Error('Fotoğraf yükleme için geçici dosya alanı bulunamadı.');
    // Native multipart uses the local basename as the uploaded filename.
    const stagedUri = `${cache}negiysem-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.${extensionFor('photo', contentType)}`;
    try {
      await FileSystem.copyAsync({ from: uri, to: stagedUri });
      const info = await FileSystem.getInfoAsync(stagedUri);
      if (!info.exists || !info.size) throw new Error('Seçilen fotoğraf okunamadı veya boş.');
      if (info.size > MAX_IMAGE_BYTES) throw new Error('Fotoğraf 20 MB sınırını aşıyor.');
      const upload = await workerUpload<UploadResult>(userId, '/upload-image', { uri: stagedUri, type: contentType }, folder);
      if (!upload.publicUrl || !upload.key) throw new Error('Sunucu geçersiz bir yükleme yanıtı gönderdi.');
      return { key: upload.key, url: upload.publicUrl };
    } finally {
      await FileSystem.deleteAsync(stagedUri, { idempotent: true }).catch(() => undefined);
    }
  });
}

export async function deleteR2Object(key: string | null | undefined): Promise<void> {
  if (!key) return;
  const userId = key.split('/')[1];
  if (!userId) throw new Error('Geçersiz dosya anahtarı.');
  await workerPost<{ ok: true }>(userId, '/delete-object', { key });
}
