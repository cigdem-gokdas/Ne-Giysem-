import * as Crypto from 'expo-crypto';
import { getDB } from './database';
import { sanitizeUserText } from '../utils/sanitize';

export type PostType = 'gallery' | 'board';
export type PostComment = {
  id: string;
  userId: string;
  username: string;
  avatarUri: string | null;
  text: string;
  createdAt: string;
  isOwner: boolean;
};
export type AppNotification = { id: string; message: string; isRead: boolean; createdAt: string };
export type ModerationReport = {
  id: string;
  reporterUsername: string;
  reportedUsername: string;
  reason: string;
  createdAt: string;
};

type CommentRow = {
  id: string; user_id: string; username: string; avatar_uri: string | null;
  text: string; createdAt: string;
};

async function getVisiblePostOwner(postType: PostType, postId: string): Promise<string | null> {
  const db = await getDB();
  const row = postType === 'gallery'
    ? await db.getFirstAsync<{ user_id: string }>('SELECT user_id FROM gallery WHERE id = ? AND is_public = 1', postId)
    : await db.getFirstAsync<{ user_id: string }>('SELECT user_id FROM mood_boards WHERE id = ? AND is_public = 1', postId);
  return row?.user_id ?? null;
}

async function assertInteractionAllowed(actorId: string, postType: PostType, postId: string): Promise<string> {
  const ownerId = await getVisiblePostOwner(postType, postId);
  if (!ownerId) throw new Error('Paylaşım bulunamadı.');
  const db = await getDB();
  const blocked = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM blocked_users
     WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`,
    actorId, ownerId, ownerId, actorId,
  );
  if (blocked) throw new Error('Bu paylaşımla etkileşim kuramazsın.');
  return ownerId;
}

async function actorName(userId: string): Promise<string> {
  const db = await getDB();
  const row = await db.getFirstAsync<{ username: string }>('SELECT username FROM users WHERE id = ?', userId);
  if (!row) throw new Error('Kullanıcı bulunamadı.');
  return row.username;
}

async function createNotification(userId: string, message: string): Promise<void> {
  const db = await getDB();
  await db.runAsync(
    'INSERT INTO notifications (id, user_id, message, is_read, createdAt) VALUES (?, ?, ?, 0, ?)',
    Crypto.randomUUID(), userId, sanitizeUserText(message, 180), new Date().toISOString(),
  );
}

export async function toggleLike(
  userId: string, postType: PostType, postId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const ownerId = await assertInteractionAllowed(userId, postType, postId);
  const db = await getDB();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM likes WHERE user_id = ? AND post_type = ? AND post_id = ?', userId, postType, postId,
  );
  let liked = false;
  if (existing) {
    await db.runAsync(
      'DELETE FROM likes WHERE id = ? AND user_id = ?', existing.id, userId,
    );
  } else {
    await db.runAsync(
      'INSERT INTO likes (id, user_id, post_type, post_id) VALUES (?, ?, ?, ?)',
      Crypto.randomUUID(), userId, postType, postId,
    );
    liked = true;
    if (ownerId !== userId) await createNotification(ownerId, `${await actorName(userId)} paylaşımını beğendi.`);
  }
  const count = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM likes WHERE post_type = ? AND post_id = ?', postType, postId,
  );
  return { liked, likeCount: count?.count ?? 0 };
}

export async function getComments(userId: string, postType: PostType, postId: string): Promise<PostComment[]> {
  await assertInteractionAllowed(userId, postType, postId);
  const db = await getDB();
  const rows = await db.getAllAsync<CommentRow>(
    `SELECT c.id, c.user_id, u.username, u.avatar_uri, c.text, c.createdAt
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_type = ? AND c.post_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM blocked_users b
         WHERE (b.blocker_id = ? AND b.blocked_id = c.user_id)
            OR (b.blocker_id = c.user_id AND b.blocked_id = ?)
       )
     ORDER BY c.createdAt ASC, c.rowid ASC`,
    postType, postId, userId, userId,
  );
  return rows.map((row) => ({
    id: row.id, userId: row.user_id, username: row.username, avatarUri: row.avatar_uri,
    text: sanitizeUserText(row.text, 300), createdAt: row.createdAt, isOwner: row.user_id === userId,
  }));
}

export async function addComment(
  userId: string, postType: PostType, postId: string, input: string,
): Promise<PostComment> {
  const text = sanitizeUserText(input, 300);
  if (!text) throw new Error('Yorum boş bırakılamaz.');
  const ownerId = await assertInteractionAllowed(userId, postType, postId);
  const username = await actorName(userId);
  const id = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const db = await getDB();
  await db.runAsync(
    'INSERT INTO comments (id, user_id, post_type, post_id, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
    id, userId, postType, postId, text, createdAt,
  );
  if (ownerId !== userId) await createNotification(ownerId, `${username} paylaşımına yorum yaptı: ${text}`);
  const user = await db.getFirstAsync<{ avatar_uri: string | null }>('SELECT avatar_uri FROM users WHERE id = ?', userId);
  return { id, userId, username, avatarUri: user?.avatar_uri ?? null, text, createdAt, isOwner: true };
}

export async function deleteComment(userId: string, commentId: string): Promise<void> {
  const db = await getDB();
  const result = await db.runAsync('DELETE FROM comments WHERE id = ? AND user_id = ?', commentId, userId);
  if (result.changes !== 1) throw new Error('Yorum bulunamadı veya bu yorumu silme yetkin yok.');
}

export async function getNotifications(userId: string): Promise<AppNotification[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<{ id: string; message: string; is_read: number; createdAt: string }>(
    'SELECT id, message, is_read, createdAt FROM notifications WHERE user_id = ? ORDER BY createdAt DESC, rowid DESC LIMIT 100',
    userId,
  );
  return rows.map((row) => ({ id: row.id, message: sanitizeUserText(row.message, 180), isRead: row.is_read === 1, createdAt: row.createdAt }));
}

export async function markNotificationsRead(userId: string): Promise<void> {
  const db = await getDB();
  await db.runAsync('UPDATE notifications SET is_read = 1 WHERE user_id = ?', userId);
}

export async function reportUser(reporterId: string, reportedId: string, input: string): Promise<void> {
  if (reporterId === reportedId) throw new Error('Kendini şikayet edemezsin.');
  const reason = sanitizeUserText(input, 240) || 'Uygunsuz içerik';
  const db = await getDB();
  const target = await db.getFirstAsync<{ id: string }>('SELECT id FROM users WHERE id = ?', reportedId);
  if (!target) throw new Error('Kullanıcı bulunamadı.');
  await db.runAsync(
    'INSERT INTO reports (id, reporter_id, reported_id, reason, createdAt) VALUES (?, ?, ?, ?, ?)',
    Crypto.randomUUID(), reporterId, reportedId, reason, new Date().toISOString(),
  );
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new Error('Kendini engelleyemezsin.');
  const db = await getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const target = await tx.getFirstAsync<{ id: string }>('SELECT id FROM users WHERE id = ?', blockedId);
    if (!target) throw new Error('Kullanıcı bulunamadı.');
    await tx.runAsync(
      'INSERT OR IGNORE INTO blocked_users (id, blocker_id, blocked_id) VALUES (?, ?, ?)',
      Crypto.randomUUID(), blockerId, blockedId,
    );
    await tx.runAsync(
      'DELETE FROM follows WHERE (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)',
      blockerId, blockedId, blockedId, blockerId,
    );
  });
}

export async function getModerationReports(adminId: string): Promise<ModerationReport[]> {
  const db = await getDB();
  const admin = await db.getFirstAsync<{ role: string }>('SELECT role FROM users WHERE id = ?', adminId);
  if (admin?.role !== 'admin') throw new Error('Bu alan yalnızca moderatörlere açıktır.');
  const rows = await db.getAllAsync<{
    id: string; reporter_username: string; reported_username: string; reason: string; createdAt: string;
  }>(
    `SELECT r.id, reporter.username AS reporter_username, reported.username AS reported_username, r.reason, r.createdAt
     FROM reports r
     JOIN users reporter ON reporter.id = r.reporter_id
     JOIN users reported ON reported.id = r.reported_id
     ORDER BY r.createdAt DESC, r.rowid DESC`,
  );
  return rows.map((row) => ({
    id: row.id, reporterUsername: row.reporter_username, reportedUsername: row.reported_username,
    reason: sanitizeUserText(row.reason, 240), createdAt: row.createdAt,
  }));
}
