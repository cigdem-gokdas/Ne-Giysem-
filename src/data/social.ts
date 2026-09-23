import { Directory, File, Paths } from 'expo-file-system';
import { getDB } from './database';
import type { ClothingItem } from './wardrobe';
import { sanitizeUserText } from '../utils/sanitize';

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
  likeCount: number;
  commentCount: number;
  likedByViewer: boolean;
};

type PostRow = {
  id: string; kind: 'gallery' | 'board'; user_id: string; username: string;
  avatarUri: string | null; bio: string; title: string; imageUri: string | null;
  items_json: string | null; createdAt: string; like_count: number; comment_count: number;
  liked_by_viewer: number;
};

const avatarDirectory = new Directory(Paths.document, 'profile-avatars');

function deleteManagedAvatar(uri: string | null): void {
  if (!uri || !uri.startsWith(`${avatarDirectory.uri.replace(/\/$/, '')}/`)) return;
  try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* Profile data remains usable. */ }
}

export async function getPublicUser(userId: string): Promise<PublicUser | null> {
  const db = await getDB();
  const row = await db.getFirstAsync<PublicUser>(
    'SELECT id, username, avatar_uri AS avatarUri, bio FROM users WHERE id = ?', userId,
  );
  return row ? { ...row, bio: sanitizeUserText(row.bio, 160) } : null;
}

export async function getDiscoverableUsers(viewerId: string): Promise<PublicUser[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<PublicUser>(
    `SELECT u.id, u.username, u.avatar_uri AS avatarUri, u.bio
     FROM users u
     WHERE u.id <> ?
       AND NOT EXISTS (
         SELECT 1 FROM blocked_users b
         WHERE (b.blocker_id = ? AND b.blocked_id = u.id)
            OR (b.blocker_id = u.id AND b.blocked_id = ?)
       )
     ORDER BY u.username COLLATE NOCASE`,
    viewerId, viewerId, viewerId,
  );
  return rows.map((row) => ({ ...row, bio: sanitizeUserText(row.bio, 160) }));
}

export async function updateBio(userId: string, bio: string): Promise<void> {
  const db = await getDB();
  const result = await db.runAsync(
    'UPDATE users SET bio = ? WHERE id = ?', sanitizeUserText(bio, 160), userId,
  );
  if (result.changes !== 1) throw new Error('Profil bulunamadı.');
}

export async function updateAvatar(userId: string, sourceUri: string): Promise<string> {
  const db = await getDB();
  const before = await db.getFirstAsync<{ avatar_uri: string | null }>(
    'SELECT avatar_uri FROM users WHERE id = ?', userId,
  );
  if (!before) throw new Error('Profil bulunamadı.');
  const source = new File(sourceUri);
  const extension = source.extension.toLowerCase();
  const safeExtension = /^\.(jpg|jpeg|png|heic|heif|webp)$/.test(extension) ? extension : '.jpg';
  avatarDirectory.create({ idempotent: true, intermediates: true });
  const destination = new File(avatarDirectory, `${userId}-${Date.now()}${safeExtension}`);
  try {
    await source.copy(destination);
    const result = await db.runAsync(
      'UPDATE users SET avatar_uri = ? WHERE id = ?', destination.uri, userId,
    );
    if (result.changes !== 1) throw new Error('Profil bulunamadı.');
    deleteManagedAvatar(before.avatar_uri);
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
    if (kind === 'gallery') {
      const result = await tx.runAsync(
        'UPDATE users SET share_gallery = ? WHERE id = ?', isPublic ? 1 : 0, userId,
      );
      if (result.changes !== 1) throw new Error('Profil bulunamadı.');
      await tx.runAsync(
        'UPDATE gallery SET is_public = ? WHERE user_id = ?', isPublic ? 1 : 0, userId,
      );
      return;
    }
    const result = await tx.runAsync(
      'UPDATE users SET share_boards = ? WHERE id = ?', isPublic ? 1 : 0, userId,
    );
    if (result.changes !== 1) throw new Error('Profil bulunamadı.');
    await tx.runAsync(
      'UPDATE mood_boards SET is_public = ? WHERE user_id = ?', isPublic ? 1 : 0, userId,
    );
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
    const blocked = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM blocked_users
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`,
      followerId, followedId, followedId, followerId,
    );
    if (blocked) throw new Error('Bu kullanıcıyı takip edemezsin.');
    await db.runAsync(
      'INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)', followerId, followedId,
    );
  } else {
    await db.runAsync(
      'DELETE FROM follows WHERE follower_id = ? AND followed_id = ?', followerId, followedId,
    );
  }
}

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
      user: {
        id: row.user_id, username: row.username, avatarUri: row.avatarUri,
        bio: sanitizeUserText(row.bio, 160),
      },
      title: sanitizeUserText(row.title, 160), imageUri: row.imageUri, items, createdAt: row.createdAt,
      likeCount: row.like_count, commentCount: row.comment_count,
      likedByViewer: row.liked_by_viewer === 1,
    };
  });
}

export async function getFeedPosts(viewerId: string): Promise<SocialPost[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<PostRow>(
    `SELECT p.id, p.kind, p.user_id, u.username, u.avatar_uri AS avatarUri, u.bio,
            p.title, p.imageUri, p.items_json, p.createdAt,
            (SELECT COUNT(*) FROM likes l WHERE l.post_type = p.kind AND l.post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_type = p.kind AND c.post_id = p.id) AS comment_count,
            EXISTS (
              SELECT 1 FROM likes own_like
              WHERE own_like.user_id = ? AND own_like.post_type = p.kind AND own_like.post_id = p.id
            ) AS liked_by_viewer
     FROM (
       SELECT id, 'gallery' AS kind, user_id, note AS title, imageUri, NULL AS items_json, createdAt
       FROM gallery WHERE is_public = 1
       UNION ALL
       SELECT id, 'board' AS kind, user_id, title, NULL AS imageUri, items_json, createdAt
       FROM mood_boards WHERE is_public = 1
     ) p
     JOIN users u ON u.id = p.user_id
     WHERE NOT EXISTS (
       SELECT 1 FROM blocked_users b
       WHERE (b.blocker_id = ? AND b.blocked_id = p.user_id)
          OR (b.blocker_id = p.user_id AND b.blocked_id = ?)
     )
     ORDER BY p.createdAt DESC
     LIMIT 100`,
    viewerId, viewerId, viewerId,
  );
  return hydratePosts(rows);
}

export async function getPublicPostsForUser(userId: string, viewerId: string): Promise<SocialPost[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<PostRow>(
    `SELECT p.id, p.kind, p.user_id, u.username, u.avatar_uri AS avatarUri, u.bio,
            p.title, p.imageUri, p.items_json, p.createdAt,
            (SELECT COUNT(*) FROM likes l WHERE l.post_type = p.kind AND l.post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_type = p.kind AND c.post_id = p.id) AS comment_count,
            EXISTS (
              SELECT 1 FROM likes own_like
              WHERE own_like.user_id = ? AND own_like.post_type = p.kind AND own_like.post_id = p.id
            ) AS liked_by_viewer
     FROM (
       SELECT id, 'gallery' AS kind, user_id, note AS title, imageUri, NULL AS items_json, createdAt
       FROM gallery WHERE is_public = 1
       UNION ALL
       SELECT id, 'board' AS kind, user_id, title, NULL AS imageUri, items_json, createdAt
       FROM mood_boards WHERE is_public = 1
     ) p
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM blocked_users b
         WHERE (b.blocker_id = ? AND b.blocked_id = p.user_id)
            OR (b.blocker_id = p.user_id AND b.blocked_id = ?)
       )
     ORDER BY p.createdAt DESC
     LIMIT 100`,
    viewerId, userId, viewerId, viewerId,
  );
  return hydratePosts(rows);
}
