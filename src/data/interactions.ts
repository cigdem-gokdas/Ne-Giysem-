import { collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { firestore } from '../config/firebase';
import { sanitizeUserText } from '../utils/sanitize';

export type PostType = 'gallery' | 'board';
export type PostComment = { id: string; userId: string; username: string; avatarUri: string | null; text: string; createdAt: string; isOwner: boolean };
export type AppNotification = { id: string; message: string; isRead: boolean; createdAt: string };
export type ModerationReport = { id: string; reporterUsername: string; reportedUsername: string; reason: string; createdAt: string };

async function assertNotBlocked(actorId: string, ownerId: string): Promise<void> {
  const [outgoing, incoming] = await Promise.all([
    getDoc(doc(firestore, 'blocked_users', `${actorId}_${ownerId}`)),
    getDoc(doc(firestore, 'blocked_users', `${ownerId}_${actorId}`)),
  ]);
  if (outgoing.exists() || incoming.exists()) throw new Error('Bu paylaşımla etkileşim kuramazsın.');
}

async function visiblePost(actorId: string, postType: PostType, postId: string) {
  const snapshot = await getDoc(doc(firestore, 'posts', postId));
  if (!snapshot.exists() || snapshot.data().isPublic !== true || snapshot.data().kind !== postType) throw new Error('Paylaşım bulunamadı.');
  await assertNotBlocked(actorId, snapshot.data().userId);
  return snapshot;
}

async function createNotification(actorId: string, userId: string, postId: string, type: 'like' | 'comment', message: string): Promise<void> {
  const ref = doc(collection(firestore, 'notifications'));
  await setDoc(ref, { actorId, userId, postId, type, message: sanitizeUserText(message, 180), isRead: false, createdAt: new Date().toISOString() });
}

export async function toggleLike(userId: string, postType: PostType, postId: string): Promise<{ liked: boolean; likeCount: number }> {
  const post = await visiblePost(userId, postType, postId);
  const likeRef = doc(firestore, 'likes', `${userId}_${postId}`);
  const existing = await getDoc(likeRef);
  const liked = !existing.exists();
  if (liked) await setDoc(likeRef, { userId, postId, postType, createdAt: new Date().toISOString() });
  else await deleteDoc(likeRef);

  const likeCount = (await getCountFromServer(query(collection(firestore, 'likes'), where('postId', '==', postId)))).data().count;
  if (liked && post.data().userId !== userId) {
    const actor = await getDoc(doc(firestore, 'users', userId));
    await createNotification(userId, post.data().userId, postId, 'like', `${actor.data()?.username ?? 'Bir kullanıcı'} paylaşımını beğendi.`);
  }
  return { liked, likeCount };
}

export async function getComments(userId: string, postType: PostType, postId: string): Promise<PostComment[]> {
  await visiblePost(userId, postType, postId);
  const rows = await getDocs(query(collection(firestore, 'comments'), where('postId', '==', postId)));
  const result: PostComment[] = [];
  for (const row of rows.docs) {
    const authorId = row.data().userId;
    try { await assertNotBlocked(userId, authorId); } catch { continue; }
    const author = await getDoc(doc(firestore, 'users', authorId));
    result.push({ id: row.id, userId: authorId, username: author.data()?.username ?? 'Kullanıcı', avatarUri: author.data()?.avatarUri ?? null, text: sanitizeUserText(row.data().text, 300), createdAt: row.data().createdAt, isOwner: authorId === userId });
  }
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addComment(userId: string, postType: PostType, postId: string, input: string): Promise<PostComment> {
  const text = sanitizeUserText(input, 300);
  if (!text) throw new Error('Yorum boş bırakılamaz.');
  const [post, author] = await Promise.all([visiblePost(userId, postType, postId), getDoc(doc(firestore, 'users', userId))]);
  if (!author.exists()) throw new Error('Kullanıcı bulunamadı.');
  const ref = doc(collection(firestore, 'comments'));
  const createdAt = new Date().toISOString();
  await setDoc(ref, { userId, postId, postType, text, createdAt });
  if (post.data().userId !== userId) await createNotification(userId, post.data().userId, postId, 'comment', `${author.data().username} paylaşımına yorum yaptı: ${text}`);
  return { id: ref.id, userId, username: author.data().username, avatarUri: author.data().avatarUri ?? null, text, createdAt, isOwner: true };
}

export async function deleteComment(userId: string, commentId: string): Promise<void> {
  const ref = doc(firestore, 'comments', commentId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().userId !== userId) throw new Error('Yorum bulunamadı veya bu yorumu silme yetkin yok.');
  await deleteDoc(ref);
}

export async function getNotifications(userId: string): Promise<AppNotification[]> {
  const rows = await getDocs(query(collection(firestore, 'notifications'), where('userId', '==', userId)));
  return rows.docs.map((row) => ({ id: row.id, message: sanitizeUserText(row.data().message, 180), isRead: row.data().isRead === true, createdAt: row.data().createdAt })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

export async function markNotificationsRead(userId: string): Promise<void> {
  const rows = await getDocs(query(collection(firestore, 'notifications'), where('userId', '==', userId)));
  await Promise.all(rows.docs.map((row) => updateDoc(row.ref, { isRead: true })));
}

export async function reportUser(reporterId: string, reportedId: string, input: string): Promise<void> {
  if (reporterId === reportedId) throw new Error('Kendini şikayet edemezsin.');
  if (!(await getDoc(doc(firestore, 'users', reportedId))).exists()) throw new Error('Kullanıcı bulunamadı.');
  await setDoc(doc(collection(firestore, 'reports')), { reporterId, reportedId, reason: sanitizeUserText(input, 240) || 'Uygunsuz içerik', createdAt: new Date().toISOString() });
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new Error('Kendini engelleyemezsin.');
  if (!(await getDoc(doc(firestore, 'users', blockedId))).exists()) throw new Error('Kullanıcı bulunamadı.');
  await setDoc(doc(firestore, 'blocked_users', `${blockerId}_${blockedId}`), { blockerId, blockedId, createdAt: new Date().toISOString() });
  await Promise.all([
    deleteDoc(doc(firestore, 'follows', `${blockerId}_${blockedId}`)),
    deleteDoc(doc(firestore, 'follows', `${blockedId}_${blockerId}`)),
  ]);
}

export async function getModerationReports(adminId: string): Promise<ModerationReport[]> {
  const admin = await getDoc(doc(firestore, 'users', adminId));
  if (admin.data()?.role !== 'admin') throw new Error('Bu alan yalnızca moderatörlere açıktır.');
  const rows = await getDocs(collection(firestore, 'reports'));
  const result: ModerationReport[] = [];
  for (const row of rows.docs) {
    const [reporter, reported] = await Promise.all([getDoc(doc(firestore, 'users', row.data().reporterId)), getDoc(doc(firestore, 'users', row.data().reportedId))]);
    result.push({ id: row.id, reporterUsername: reporter.data()?.username ?? 'Silinmiş kullanıcı', reportedUsername: reported.data()?.username ?? 'Silinmiş kullanıcı', reason: sanitizeUserText(row.data().reason, 240), createdAt: row.data().createdAt });
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
