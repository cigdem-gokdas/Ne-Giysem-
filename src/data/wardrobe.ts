import { Directory, File, Paths } from 'expo-file-system';
import { getDB } from './database';
import { deleteGalleryPhotos, getGalleryEntries } from './outfitGallery';

export type ClothingTags = { tur: string; renk: string; desen: string };
export type ClothingItem = { id: string; imageUri: string; tags: ClothingTags };
export const CLOTHING_TYPES = ['üst', 'alt', 'dış giyim', 'ayakkabı', 'aksesuar'] as const;

type WardrobeRow = { id: string; imageUri: string; tur: string; renk: string; desen: string };
const photoDirectory = new Directory(Paths.document, 'wardrobe-photos');

function toItem(row: WardrobeRow): ClothingItem {
  return { id: row.id, imageUri: row.imageUri, tags: { tur: row.tur, renk: row.renk, desen: row.desen } };
}

function deleteManagedPhoto(imageUri: string): void {
  const managedDirectory = `${photoDirectory.uri.replace(/\/$/, '')}/`;
  if (!imageUri.startsWith(managedDirectory)) return;
  try {
    const photo = new File(imageUri);
    if (photo.exists) photo.delete();
  } catch { /* A deleted database row must stay deleted. */ }
}

export async function getClothingItems(userId: string): Promise<ClothingItem[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<WardrobeRow>(
    'SELECT id, imageUri, tur, renk, desen FROM wardrobe WHERE user_id = ? ORDER BY rowid DESC',
    userId,
  );
  return rows.map(toItem);
}

export async function addClothingItem(userId: string, sourceUri: string, tags: ClothingTags): Promise<ClothingItem> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const source = new File(sourceUri);
  const extension = source.extension.toLowerCase();
  const safeExtension = /^\.(jpg|jpeg|png|heic|heif|webp|gif)$/.test(extension) ? extension : '.jpg';
  const destination = new File(photoDirectory, `${id}${safeExtension}`);
  photoDirectory.create({ idempotent: true, intermediates: true });
  try {
    await source.copy(destination);
    const db = await getDB();
    await db.runAsync(
      'INSERT INTO wardrobe (id, user_id, imageUri, tur, renk, desen, son_kullanim) VALUES (?, ?, ?, ?, ?, ?, NULL)',
      id, userId, destination.uri, tags.tur, tags.renk, tags.desen,
    );
    return { id, imageUri: destination.uri, tags };
  } catch (error) {
    try { if (destination.exists) destination.delete(); } catch { /* Keep original error. */ }
    throw error;
  }
}

export async function updateClothingTags(userId: string, id: string, tags: ClothingTags): Promise<ClothingItem> {
  const cleaned: ClothingTags = {
    tur: tags.tur.trim().toLocaleLowerCase('tr-TR'),
    renk: tags.renk.trim(),
    desen: tags.desen.trim(),
  };
  if (!CLOTHING_TYPES.some((type) => type === cleaned.tur) || !cleaned.renk || !cleaned.desen) {
    throw new Error('Etiketler eksik veya geçersiz.');
  }
  const db = await getDB();
  const result = await db.runAsync(
    'UPDATE wardrobe SET tur = ?, renk = ?, desen = ? WHERE id = ? AND user_id = ?',
    cleaned.tur, cleaned.renk, cleaned.desen, id, userId,
  );
  if (result.changes !== 1) throw new Error('Kıyafet bulunamadı.');
  const row = await db.getFirstAsync<WardrobeRow>(
    'SELECT id, imageUri, tur, renk, desen FROM wardrobe WHERE id = ? AND user_id = ?',
    id, userId,
  );
  if (!row) throw new Error('Kıyafet bulunamadı.');
  return toItem(row);
}

export async function deleteClothingItem(userId: string, id: string): Promise<void> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ imageUri: string }>(
    'SELECT imageUri FROM wardrobe WHERE id = ? AND user_id = ?', id, userId,
  );
  if (!row) throw new Error('Kıyafet bulunamadı.');
  const result = await db.runAsync('DELETE FROM wardrobe WHERE id = ? AND user_id = ?', id, userId);
  if (result.changes !== 1) throw new Error('Kıyafet bulunamadı.');
  deleteManagedPhoto(row.imageUri);
}

export async function clearClothingItems(userId: string): Promise<void> {
  const items = await getClothingItems(userId);
  const db = await getDB();
  await db.runAsync('DELETE FROM wardrobe WHERE user_id = ?', userId);
  items.forEach((item) => deleteManagedPhoto(item.imageUri));
}

export async function resetLocalData(userId: string): Promise<void> {
  const [items, gallery] = await Promise.all([getClothingItems(userId), getGalleryEntries(userId)]);
  const db = await getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM wardrobe WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM gallery WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM mood_boards WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM follows WHERE follower_id = ?', userId);
    await tx.runAsync('DELETE FROM chat_sessions WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM outfit_history WHERE user_id = ?', userId);
  });
  items.forEach((item) => deleteManagedPhoto(item.imageUri));
  deleteGalleryPhotos(gallery);
}
