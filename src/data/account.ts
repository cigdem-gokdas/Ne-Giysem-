import { Directory, File, Paths } from 'expo-file-system';
import { verifyAccountDeletion } from './auth';
import { getDB } from './database';

type ImageRow = { imageUri: string };

const managedDirectories = [
  new Directory(Paths.document, 'wardrobe-photos'),
  new Directory(Paths.document, 'outfit-gallery'),
  new Directory(Paths.document, 'profile-avatars'),
];

function deleteManagedFile(uri: string | null): void {
  if (!uri) return;
  const managed = managedDirectories.some((directory) => uri.startsWith(`${directory.uri.replace(/\/$/, '')}/`));
  if (!managed) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch { /* The deleted account must stay deleted even if an old file is already gone. */ }
}

export async function deleteUserAccount(userId: string, currentPassword?: string): Promise<void> {
  await verifyAccountDeletion(userId, currentPassword);
  const db = await getDB();
  const [wardrobeImages, galleryImages, profile] = await Promise.all([
    db.getAllAsync<ImageRow>('SELECT imageUri FROM wardrobe WHERE user_id = ?', userId),
    db.getAllAsync<ImageRow>('SELECT imageUri FROM gallery WHERE user_id = ?', userId),
    db.getFirstAsync<{ avatar_uri: string | null }>('SELECT avatar_uri FROM users WHERE id = ?', userId),
  ]);

  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `DELETE FROM likes
       WHERE (post_type = 'gallery' AND post_id IN (SELECT id FROM gallery WHERE user_id = ?))
          OR (post_type = 'board' AND post_id IN (SELECT id FROM mood_boards WHERE user_id = ?))`,
      userId, userId,
    );
    await tx.runAsync(
      `DELETE FROM comments
       WHERE user_id = ?
          OR (post_type = 'gallery' AND post_id IN (SELECT id FROM gallery WHERE user_id = ?))
          OR (post_type = 'board' AND post_id IN (SELECT id FROM mood_boards WHERE user_id = ?))`,
      userId, userId, userId,
    );
    await tx.runAsync('DELETE FROM likes WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM notifications WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM reports WHERE reporter_id = ? OR reported_id = ?', userId, userId);
    await tx.runAsync('DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?', userId, userId);
    await tx.runAsync('DELETE FROM follows WHERE follower_id = ? OR followed_id = ?', userId, userId);
    await tx.runAsync('DELETE FROM api_usage WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM wardrobe WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM gallery WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM mood_boards WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM chat_sessions WHERE user_id = ?', userId);
    await tx.runAsync('DELETE FROM outfit_history WHERE user_id = ?', userId);
    const result = await tx.runAsync('DELETE FROM users WHERE id = ?', userId);
    if (result.changes !== 1) throw new Error('Hesap bulunamadı.');
  });

  wardrobeImages.forEach(({ imageUri }) => deleteManagedFile(imageUri));
  galleryImages.forEach(({ imageUri }) => deleteManagedFile(imageUri));
  deleteManagedFile(profile?.avatar_uri ?? null);
}
