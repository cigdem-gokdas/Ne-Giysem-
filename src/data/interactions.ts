import { budgetTransaction, budgetWrites, limitedSet } from './writeBudget';
import { limit, orderBy, startAfter, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDocsWithIndexFallbackInfo } from './firestoreQuery';
import { firebaseAuth, firestore } from '../config/firebase';
import { sanitizeUserText } from '../utils/sanitize';
import { assertCleanText } from '../utils/moderation';

export type PostType = 'gallery' | 'board';
export type PostComment = { id: string; userId: string; username: string; avatarUri: string | null; text: string; createdAt: string; isOwner: boolean };
export type AppNotification = { id: string; message: string; isRead: boolean; createdAt: string };
export type ReportTargetType = 'user' | 'post' | 'comment';
export type ModerationReport = { id: string; reporterUsername: string; reportedUsername: string; reason: string; createdAt: string; targetType: ReportTargetType };
export type NotificationPage = { items: AppNotification[]; cursor?: QueryDocumentSnapshot; degraded: boolean };

const NOTIFICATION_PAGE_SIZE = 25;

async function assertNotBlocked(actorId: string, ownerId: string): Promise<void> {
  const [outgoing, incoming] = await Promise.all([
    getDoc(doc(firestore, 'blocked_users', `${actorId}_${ownerId}`)),
    getDoc(doc(firestore, 'blocked_users', `${ownerId}_${actorId}`)).then((snapshot) => snapshot.exists(), () => false), // rules hide who blocked me; blocking is enforced server-side
  ]);
  if (outgoing.exists() || incoming) throw new Error('Bu paylaşımla etkileşim kuramazsın.');
}

async function visiblePost(actorId: string, postType: PostType, postId: string) {
  const snapshot = await getDoc(doc(firestore, 'posts', postId));
  if (!snapshot.exists() || snapshot.data().isPublic !== true || snapshot.data().kind !== postType) throw new Error('Paylaşım bulunamadı.');
  await assertNotBlocked(actorId, snapshot.data().userId);
  return snapshot;
}

async function createNotification(actorId: string, userId: string, postId: string, type: 'like' | 'comment', message: string, sourceId: string): Promise<void> {
  const ref = doc(firestore, 'notifications', `${type}_${sourceId}`);
  await limitedSet(ref, { actorId, userId, postId, type, sourceId, message: sanitizeUserText(message, 180), isRead: false, createdAt: new Date().toISOString() });
}

export async function toggleLike(userId: string, postType: PostType, postId: string): Promise<{ liked: boolean; likeCount: number }> {
  const post = await visiblePost(userId, postType, postId);
  const likeRef = doc(firestore, 'likes', `${userId}_${postId}`);
  // Existence check and write happen in one transaction so rapid or concurrent taps cannot double-toggle.
  const liked = await budgetTransaction(async (transaction) => {
    const existing = await transaction.get(likeRef);
    if (existing.exists()) return { result: false, deletes: [likeRef] };
    return { result: true, writes: [{ ref: likeRef, data: { userId, postId, postType, createdAt: new Date().toISOString() } }] };
  });

  const likeCount = (await getCountFromServer(query(collection(firestore, 'likes'), where('postId', '==', postId), limit(50)))).data().count;
  if (liked && post.data().userId !== userId) {
    const actor = await getDoc(doc(firestore, 'users', userId));
    await createNotification(userId, post.data().userId, postId, 'like', `${actor.data()?.username ?? 'Bir kullanıcı'} paylaşımını beğendi.`, `${userId}_${postId}`).catch(() => undefined);
  }
  return { liked, likeCount };
}

export async function getComments(userId: string, postType: PostType, postId: string): Promise<PostComment[]> {
  await visiblePost(userId, postType, postId);
  const rows = await getDocs(query(collection(firestore, 'comments'), where('postId', '==', postId), limit(50)));
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
  assertCleanText(text, 'Yorumun');
  const [post, author] = await Promise.all([visiblePost(userId, postType, postId), getDoc(doc(firestore, 'users', userId))]);
  if (!author.exists()) throw new Error('Kullanıcı bulunamadı.');
  const ref = doc(collection(firestore, 'comments'));
  const createdAt = new Date().toISOString();
  await limitedSet(ref, { userId, postId, postType, text, createdAt });
  if (post.data().userId !== userId) await createNotification(userId, post.data().userId, postId, 'comment', `${author.data().username} paylaşımına yorum yaptı: ${text}`, ref.id).catch(() => undefined);
  return { id: ref.id, userId, username: author.data().username, avatarUri: author.data().avatarUri ?? null, text, createdAt, isOwner: true };
}

export async function deleteComment(userId: string, commentId: string): Promise<void> {
  const ref = doc(firestore, 'comments', commentId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().userId !== userId) throw new Error('Yorum bulunamadı veya bu yorumu silme yetkin yok.');
  await deleteDoc(ref);
}

export async function getNotificationsPage(userId: string, cursor?: QueryDocumentSnapshot): Promise<NotificationPage> {
  const base = collection(firestore, 'notifications');
  const tail = cursor ? [startAfter(cursor)] : [];
  const { snapshot: rows, degraded } = await getDocsWithIndexFallbackInfo(
    query(base, where('userId', '==', userId), orderBy('createdAt', 'desc'), ...tail, limit(NOTIFICATION_PAGE_SIZE)),
    query(base, where('userId', '==', userId), ...tail, limit(NOTIFICATION_PAGE_SIZE)),
  );
  const items = rows.docs.map((row) => ({ id: row.id, message: sanitizeUserText(row.data().message, 180), isRead: row.data().isRead === true, createdAt: row.data().createdAt as string }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Without the ordered index the cursor order is undefined, so paging stops after the degraded page.
  return { items, cursor: !degraded && rows.size === NOTIFICATION_PAGE_SIZE ? rows.docs[rows.docs.length - 1] : undefined, degraded };
}

export async function getNotifications(userId: string): Promise<AppNotification[]> {
  return (await getNotificationsPage(userId)).items;
}

/** Marks only the notifications the user is currently looking at (by id), never newer unseen ones.
 * Returns how many were marked; throws a partial-failure message when a later chunk fails. */
export async function markNotificationsRead(userId: string, ids: string[]): Promise<number> {
  const unique = [...new Set(ids)];
  let marked = 0;
  for (let offset = 0; offset < unique.length; offset += 2) {
    const chunk = unique.slice(offset, offset + 2);
    try {
      await budgetWrites(chunk.map((id) => ({ ref: doc(firestore, 'notifications', id), data: { isRead: true }, update: true })));
      marked += chunk.length;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'Bilinmeyen hata';
      throw new Error(marked > 0 ? `${marked} bildirim okundu işaretlendi, kalanlar işaretlenemedi: ${reason}` : reason);
    }
  }
  return marked;
}

/** Reports a user, post or comment. Document id and shape are fixed by the Firestore rules. */
export async function reportContent(reporterId: string, targetType: ReportTargetType, targetId: string, input: string): Promise<void> {
  let reportedId: string;
  if (targetType === 'user') {
    if (!(await getDoc(doc(firestore, 'users', targetId))).exists()) throw new Error('Kullanıcı bulunamadı.');
    reportedId = targetId;
  } else {
    const target = await getDoc(doc(firestore, targetType === 'post' ? 'posts' : 'comments', targetId));
    if (!target.exists() || typeof target.data().userId !== 'string') throw new Error(targetType === 'post' ? 'Paylaşım bulunamadı.' : 'Yorum bulunamadı.');
    reportedId = target.data().userId;
  }
  if (reporterId === reportedId) throw new Error(targetType === 'user' ? 'Kendini şikayet edemezsin.' : 'Kendi içeriğini bildiremezsin.');
  const ref = doc(firestore, 'reports', `${reporterId}_${targetType}_${targetId}`);
  const already = await getDoc(ref).then((snapshot) => snapshot.exists(), () => false);
  if (already) throw new Error('Bunu zaten bildirdin. İncelemeye alındı.');
  await limitedSet(ref, { reporterId, reportedId, targetType, targetId, reason: sanitizeUserText(input, 300) || 'Uygunsuz içerik', createdAt: new Date().toISOString() });
}

export function reportUser(reporterId: string, reportedId: string, input: string): Promise<void> {
  return reportContent(reporterId, 'user', reportedId, input);
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) throw new Error('Kendini engelleyemezsin.');
  if (!(await getDoc(doc(firestore, 'users', blockedId))).exists()) throw new Error('Kullanıcı bulunamadı.');
  await limitedSet(doc(firestore, 'blocked_users', `${blockerId}_${blockedId}`), { blockerId, blockedId, createdAt: new Date().toISOString() });
  await Promise.all([
    deleteDoc(doc(firestore, 'follows', `${blockerId}_${blockedId}`)),
    deleteDoc(doc(firestore, 'follows', `${blockedId}_${blockerId}`)),
  ]);
}

export async function getModerationReports(adminId: string): Promise<ModerationReport[]> {
  const admin = await getDoc(doc(firestore, 'users', adminId));
  if (firebaseAuth.currentUser?.uid !== adminId || (await firebaseAuth.currentUser.getIdTokenResult()).claims.admin !== true) throw new Error('Bu alan yalnızca moderatörlere açıktır.');
  const rows = await getDocs(query(collection(firestore, 'reports'), limit(50)));
  const result: ModerationReport[] = [];
  for (const row of rows.docs) {
    const userName = async (id: unknown) => {
      // Legacy or anonymised reports carry reporterId 'deleted' (or none): show the placeholder instead of reading.
      if (typeof id !== 'string' || !id || id === 'deleted') return undefined;
      return (await getDoc(doc(firestore, 'users', id)).catch(() => null))?.data()?.username as string | undefined;
    };
    const [reporter, reported] = await Promise.all([userName(row.data().reporterId), userName(row.data().reportedId)]);
    result.push({ id: row.id, reporterUsername: reporter ?? 'Silinmiş kullanıcı', reportedUsername: reported ?? 'Silinmiş kullanıcı', reason: sanitizeUserText(row.data().reason, 300), createdAt: row.data().createdAt, targetType: (['user', 'post', 'comment'] as const).find((type) => type === row.data().targetType) ?? 'user' });
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
