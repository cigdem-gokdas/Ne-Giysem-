import { Directory, File, Paths } from 'expo-file-system';
import { getDB } from './database';
import { sanitizeUserText } from '../utils/sanitize';

export type GalleryEntry = { id: string; imageUri: string; note: string; createdAt: string; isPublic: boolean };
type GalleryRow = { id: string; imageUri: string; note: string; createdAt: string; is_public: number };
const photoDirectory = new Directory(Paths.document, 'outfit-gallery');

function deleteManagedPhoto(imageUri: string): void {
  const managedDirectory = `${photoDirectory.uri.replace(/\/$/, '')}/`;
  if (!imageUri.startsWith(managedDirectory)) return;
  try {
    const photo = new File(imageUri);
    if (photo.exists) photo.delete();
  } catch { /* The database remains the source of truth. */ }
}

export async function getGalleryEntries(userId: string): Promise<GalleryEntry[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<GalleryRow>(
    'SELECT id, imageUri, note, createdAt, is_public FROM gallery WHERE user_id = ? ORDER BY createdAt DESC, rowid DESC', userId,
  );
  return rows.map(({ is_public, ...row }) => ({ ...row, note: sanitizeUserText(row.note, 160), isPublic: is_public === 1 }));
}

export async function addGalleryEntry(userId: string, sourceUri: string, note: string): Promise<GalleryEntry> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const source = new File(sourceUri);
  const extension = source.extension.toLowerCase();
  const safeExtension = /^\.(jpg|jpeg|png|heic|heif|webp)$/.test(extension) ? extension : '.jpg';
  const destination = new File(photoDirectory, `${id}${safeExtension}`);
  photoDirectory.create({ idempotent: true, intermediates: true });
  try {
    await source.copy(destination);
    const entry: GalleryEntry = { id, imageUri: destination.uri, note: sanitizeUserText(note, 160), createdAt: new Date().toISOString(), isPublic: false };
    const db = await getDB();
    const result = await db.runAsync(
      'INSERT INTO gallery (id, user_id, imageUri, note, createdAt, is_public) SELECT ?, id, ?, ?, ?, share_gallery FROM users WHERE id = ?',
      entry.id, entry.imageUri, entry.note, entry.createdAt, userId,
    );
    if (result.changes !== 1) throw new Error('Kullanıcı bulunamadı.');
    const setting = await db.getFirstAsync<{ share_gallery: number }>('SELECT share_gallery FROM users WHERE id = ?', userId);
    entry.isPublic = setting?.share_gallery === 1;
    return entry;
  } catch (error) {
    try { if (destination.exists) destination.delete(); } catch { /* Keep original error. */ }
    throw error;
  }
}

export async function deleteGalleryEntry(userId: string, id: string): Promise<void> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ imageUri: string }>(
    'SELECT imageUri FROM gallery WHERE id = ? AND user_id = ?', id, userId,
  );
  if (!row) throw new Error('Fotoğraf bulunamadı.');
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync("DELETE FROM likes WHERE post_type = 'gallery' AND post_id = ?", id);
    await tx.runAsync("DELETE FROM comments WHERE post_type = 'gallery' AND post_id = ?", id);
    const result = await tx.runAsync('DELETE FROM gallery WHERE id = ? AND user_id = ?', id, userId);
    if (result.changes !== 1) throw new Error('Fotoğraf bulunamadı.');
  });
  deleteManagedPhoto(row.imageUri);
}

export function deleteGalleryPhotos(entries: GalleryEntry[]): void {
  entries.forEach(({ imageUri }) => deleteManagedPhoto(imageUri));
}
