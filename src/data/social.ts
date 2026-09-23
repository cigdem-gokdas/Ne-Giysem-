import { Directory, File, Paths } from 'expo-file-system';
import { getDB } from './database';
import type { ClothingItem } from './wardrobe';

export type PublicUser = { id: string; username: string; avatarUri: string | null; bio: string };
export type ShareSettings = { gallery: boolean; boards: boolean };
export type SocialPost = {
  id: string;
  kind: 'gallery' | 'board';
  user: PublicUser;
  title: string;
  imageUri: string | null;
  items: ClothingItem[];
  createdAt: string;
};

type PostRow = {
  id: string; kind: 'gallery' | 'board'; user_id: string; username: string;
  avatarUri: string | null; bio: string; title: string; imageUri: string | null;
  items_json: string | null; createdAt: string;
};

const avatarDirectory = new Directory(Paths.document, 'profile-avatars');

function deleteManagedAvatar(uri: string | null): void {
  if (!uri || !uri.startsWith(`${avatarDirectory.uri.replace(/\/$/, '')}/`)) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Profile data remains usable. */ }
}

export async function getPublicUser(userId: string): Promise<PublicUser | null> {
  const db = await getDB();
  return db.getFirstAsync<PublicUser>('SELECT id, username, avatarUri, bio FROM users WHERE id = ?', userId);
}

export async function getDiscoverableUsers(viewerId: string): Promise<PublicUser[]> {
  const db = await getDB();
  return db.getAllAsync<PublicUser>(
    'SELECT id, username, avatarUri, bio FROM users WHERE id <> ? ORDER BY username COLLATE NOCASE', viewerId,
  );
}

export async function updateBio(userId: string, bio: string): Promise<void> {
  const db = await getDB();
  const result = await db.runAsync('UPDATE users SET bio = ? WHERE id = ?', bio.trim().slice(0, 160), userId);
  if (result.changes !== 1) throw new Error('Profil bulunamadı.');
}

export async function updateAvatar(userId: string, sourceUri: string): Promise<string> {
  const db = await getDB();
  const before = await db.getFirstAsync<{ avatarUri: string | null }>('SELECT avatarUri FROM users WHERE id = ?', userId);
  if (!before) throw new Error('Profil bulunamadı.');
  const source = new File(sourceUri);
  const extension = source.extension.toLowerCase();
  const safeExtension = /^\.(jpg|jpeg|png|heic|heif|webp)$/.test(extension) ? extension : '.jpg';
  avatarDirectory.create({ idempotent: true, intermediates: true });
  const destination = new File(avatarDirectory, `${userId}-${Date.now()}${safeExtension}`);
  try {
    await source.copy(destination);
    await db.runAsync('UPDATE users SET avatarUri = ? WHERE id = ?', destination.uri, userId);
    deleteManagedAvatar(before.avatarUri);
    return destination.uri;
  } catch (error) {
    try { if (destination.exists) destination.delete(); } catch { /* Preserve original error. */ }
    throw error;
  }
}

export async function getShareSettings(userId: string): Promise<ShareSettings> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ share_gallery: number; share_boards: number }>(
    'SELECT share_gallery, share_boards FROM users WHERE id = ?', userId,
  );
  if (!row) throw new Error('Profil bulunamadı.');
  return { gallery: row.share_gallery === 1, boards: row.share_boards === 1 };
}

export async function setShareSetting(userId: string, kind: 'gallery' | 'boards', isPublic: boolean): Promise<void> {
  const db = await getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const column = kind === 'gallery' ? 'share_gallery' : 'share_boards';
    const table = kind === 'gallery' ? 'gallery' : 'mood_boards';
    const result = await tx.runAsync(`UPDATE users SET ${column} = ? WHERE id = ?`, isPublic ? 1 : 0, userId);
    if (result.changes !== 1) throw new Error('Profil bulunamadı.');
    await tx.runAsync(`UPDATE ${table} SET is_public = ? WHERE user_id = ?`, isPublic ? 1 : 0, userId);
  });
}

export async function isFollowing(followerId: string, followedId: string): Promise<boolean> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ follower_id: string }>(
    'SELECT follower_id FROM follows WHERE follower_id = ? AND followed_id = ?', followerId, followedId,
  );
  return !!row;
}

export async function setFollowing(followerId: string, followedId: string, follow: boolean): Promise<void> {
  if (followerId === followedId) throw new Error('Kendini takip edemezsin.');
  const db = await getDB();
  if (follow) {
    await db.runAsync('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)', followerId, followedId);
  } else {
    await db.runAsync('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?', followerId, followedId);
  }
}

const postSelect = `
  SELECT p.id, p.kind, p.user_id, u.username, u.avatarUri, u.bio, p.title, p.imageUri, p.items_json, p.createdAt
  FROM (
    SELECT id, 'gallery' AS kind, user_id, note AS title, imageUri, NULL AS items_json, createdAt FROM gallery WHERE is_public = 1
    UNION ALL
    SELECT id, 'board' AS kind, user_id, title, NULL AS imageUri, items_json, createdAt FROM mood_boards WHERE is_public = 1
  ) p JOIN users u ON u.id = p.user_id`;

async function hydratePosts(rows: PostRow[]): Promise<SocialPost[]> {
  const db = await getDB();
  const boards = rows.filter((row) => row.kind === 'board');
  const owners = [...new Set(boards.map((row) => row.user_id))];
  const wardrobeByOwner = new Map<string, Map<string, ClothingItem>>();
  for (const owner of owners) {
    const items = await db.getAllAsync<{ id: string; imageUri: string; tur: string; renk: string; desen: string }>(
      'SELECT id, imageUri, tur, renk, desen FROM wardrobe WHERE user_id = ?', owner,
    );
    wardrobeByOwner.set(owner, new Map(items.map((item) => [item.id, {
      id: item.id, imageUri: item.imageUri,
      tags: { tur: item.tur, renk: item.renk, desen: item.desen },
    }])));
  }
  return rows.map((row) => {
    let items: ClothingItem[] = [];
    if (row.kind === 'board' && row.items_json) {
      try {
        const ids: unknown = JSON.parse(row.items_json);
        if (Array.isArray(ids)) items = ids.flatMap((id) => {
          const piece = typeof id === 'string' ? wardrobeByOwner.get(row.user_id)?.get(id) : undefined;
          return piece ? [piece] : [];
        });
      } catch { /* A malformed old board can still show its title. */ }
    }
    return {
      id: row.id, kind: row.kind,
      user: { id: row.user_id, username: row.username, avatarUri: row.avatarUri, bio: row.bio },
      title: row.title, imageUri: row.imageUri, items, createdAt: row.createdAt,
    };
  });
}

export async function getFeedPosts(viewerId: string): Promise<SocialPost[]> {
  const db = await getDB();
  const followed = await db.getAllAsync<PostRow>(
    `${postSelect} WHERE p.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?) ORDER BY p.createdAt DESC LIMIT 60`, viewerId,
  );
  if (followed.length > 0) return hydratePosts(followed);
  const own = await db.getAllAsync<PostRow>(
    `${postSelect} WHERE p.user_id = ? ORDER BY p.createdAt DESC LIMIT 60`, viewerId,
  );
  return hydratePosts(own);
}

export async function getPublicPostsForUser(userId: string): Promise<SocialPost[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<PostRow>(
    `${postSelect} WHERE p.user_id = ? ORDER BY p.createdAt DESC LIMIT 100`, userId,
  );
  return hydratePosts(rows);
}
