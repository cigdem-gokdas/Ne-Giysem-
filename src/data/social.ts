import { forEachPage } from './paging';
import { budgetWrites, limitedSet, limitedUpdate } from './writeBudget';
import { limit, orderBy, startAfter, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, where, writeBatch, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDocsWithIndexFallback, getDocsWithIndexFallbackInfo } from './firestoreQuery';
import { firestore } from '../config/firebase';
import { deleteR2Object, uploadImageToR2, type ImageUploadMetadata } from '../services/r2Storage';
import { sanitizeUserText } from '../utils/sanitize';
import { assertCleanText } from '../utils/moderation';
import type { ClothingItem } from './wardrobe';

export type PublicUser = { id: string; username: string; avatarUri: string | null; bio: string };
export type ShareSettings = { gallery: boolean; boards: boolean };
export type FeedPage = { posts: SocialPost[]; cursor?: QueryDocumentSnapshot; degraded: boolean };
const FEED_PAGE_SIZE = 20;
export type SocialPost = { id: string; kind: 'gallery' | 'board'; user: PublicUser; title: string; imageUri: string | null; items: ClothingItem[]; createdAt: string; likeCount: number; commentCount: number; likedByViewer: boolean };

export async function getPublicUser(userId: string): Promise<PublicUser | null> {
  const snapshot = await getDoc(doc(firestore, 'users', userId));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, username: snapshot.data().username, avatarUri: snapshot.data().avatarUri ?? null, bio: sanitizeUserText(snapshot.data().bio ?? '', 160) };
}

async function blocked(viewerId: string, candidates: string[]): Promise<Set<string>> {
  const excluded = new Set<string>();
  await Promise.all([...new Set(candidates)].filter((id) => id !== viewerId).map(async (id) => {
    const [outgoing, incoming] = await Promise.all([
      getDoc(doc(firestore, 'blocked_users', `${viewerId}_${id}`)),
      getDoc(doc(firestore, 'blocked_users', `${id}_${viewerId}`)).then((snapshot) => snapshot.exists(), () => false), // reverse direction is hidden by rules
    ]);
    if (outgoing.exists() || incoming) excluded.add(id);
  }));
  return excluded;
}

export async function getDiscoverableUsers(viewerId: string): Promise<PublicUser[]> {
  const rows = await getDocs(query(collection(firestore, 'users'), limit(50)));
  const excluded = await blocked(viewerId, rows.docs.map((row) => row.id));
  return rows.docs.filter((row) => row.id !== viewerId && !excluded.has(row.id)).map((row) => ({ id: row.id, username: row.data().username, avatarUri: row.data().avatarUri ?? null, bio: sanitizeUserText(row.data().bio ?? '', 160) })).sort((a, b) => a.username.localeCompare(b.username, 'tr'));
}

export async function updateBio(userId: string, bio: string): Promise<void> {
  const clean = sanitizeUserText(bio, 160);
  assertCleanText(clean, 'Biyografin');
  await limitedUpdate(doc(firestore, 'users', userId), { bio: clean });
}

export async function updateAvatar(userId: string, sourceUri: string, metadata: ImageUploadMetadata = {}): Promise<string> {
  const ref = doc(firestore, 'users', userId);
  const before = await getDoc(ref);
  if (!before.exists()) throw new Error('Profil bulunamadı.');
  const upload = await uploadImageToR2(userId, 'avatars', sourceUri, metadata);
  try {
    await limitedUpdate(ref, { avatarUri: upload.url, avatarKey: upload.key });
  } catch (error) {
    await deleteR2Object(upload.key).catch(() => undefined);
    throw error;
  }
  await deleteR2Object(before.data().avatarKey).catch(() => undefined);
  return upload.url;
}

export async function getShareSettings(userId: string): Promise<ShareSettings> {
  const snapshot = await getDoc(doc(firestore, 'users', userId));
  if (!snapshot.exists()) throw new Error('Profil bulunamadı.');
  return { gallery: snapshot.data().shareGallery === true, boards: snapshot.data().shareBoards === true };
}

/** Updates visibility of already existing content in chunks. Making content public is charged against the daily
 * write budget (2 docs per charge); withdrawing is free and uses plain batches so privacy works at the limit. */
async function setVisibility(refs: Array<QueryDocumentSnapshot<DocumentData>['ref']>, isPublic: boolean): Promise<number> {
  let done = 0;
  try {
    if (isPublic) {
      for (let offset = 0; offset < refs.length; offset += 2) {
        const chunk = refs.slice(offset, offset + 2);
        await budgetWrites(chunk.map((ref) => ({ ref, data: { isPublic: true }, update: true })));
        done += chunk.length;
      }
    } else {
      for (let offset = 0; offset < refs.length; offset += 400) {
        const chunk = refs.slice(offset, offset + 400);
        const batch = writeBatch(firestore);
        chunk.forEach((ref) => batch.update(ref, { isPublic: false }));
        await batch.commit();
        done += chunk.length;
      }
    }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'Bilinmeyen hata';
    throw new Error(`${done}/${refs.length} paylaşım güncellendi; kalanlar güncellenemedi (${reason}). ${isPublic ? 'Tercihin henüz değişmedi, tekrar dene.' : 'Bazı paylaşımların hâlâ herkese açık olabileceğini unutma; tekrar dene.'}`);
  }
  return done;
}

export async function setShareSetting(userId: string, kind: 'gallery' | 'boards', isPublic: boolean): Promise<void> {
  const targetKind = kind === 'gallery' ? 'gallery' : 'board';
  const postRefs: Array<QueryDocumentSnapshot<DocumentData>['ref']> = [];
  await forEachPage(query(collection(firestore, 'posts'), where('userId', '==', userId)), async (rows) => {
    rows.filter((row) => row.data().kind === targetKind && row.data().isPublic !== isPublic).forEach((row) => postRefs.push(row.ref));
  });
  const boardRefs: Array<QueryDocumentSnapshot<DocumentData>['ref']> = [];
  if (kind === 'boards') await forEachPage(query(collection(firestore, 'mood_boards'), where('userId', '==', userId)), async (rows) => {
    rows.filter((row) => row.data().isPublic !== isPublic).forEach((row) => boardRefs.push(row.ref));
  });
  await setVisibility(postRefs, isPublic);
  await setVisibility(boardRefs, isPublic);
  // The profile flag is written LAST: if anything above failed, the flag still reflects the real state.
  const data = { [kind === 'gallery' ? 'shareGallery' : 'shareBoards']: isPublic };
  if (isPublic) await limitedUpdate(doc(firestore, 'users', userId), data);
  else await writeBatch(firestore).update(doc(firestore, 'users', userId), data).commit(); // Privacy withdrawal must work at the write limit.
}

export async function isFollowing(followerId: string, followedId: string): Promise<boolean> {
  return (await getDoc(doc(firestore, 'follows', `${followerId}_${followedId}`))).exists();
}

export async function setFollowing(followerId: string, followedId: string, follow: boolean): Promise<void> {
  if (followerId === followedId) throw new Error('Kendini takip edemezsin.');
  const ref = doc(firestore, 'follows', `${followerId}_${followedId}`);
  if (!follow) { await deleteDoc(ref); return; }
  const [user, outgoing, incoming] = await Promise.all([
    getDoc(doc(firestore, 'users', followedId)),
    getDoc(doc(firestore, 'blocked_users', `${followerId}_${followedId}`)),
    getDoc(doc(firestore, 'blocked_users', `${followedId}_${followerId}`)).then((snapshot) => snapshot.exists(), () => false),
  ]);
  if (!user.exists()) throw new Error('Kullanıcı bulunamadı.');
  if (outgoing.exists() || incoming) throw new Error('Bu kullanıcıyı takip edemezsin.');
  await limitedSet(ref, { followerId, followedId, createdAt: new Date().toISOString() });
}

async function hydrate(posts: QueryDocumentSnapshot<DocumentData>[], viewerId: string): Promise<SocialPost[]> {
  const authors = new Map<string, Promise<PublicUser | null>>();
  const profile = (id: string) => { if (!authors.has(id)) authors.set(id, getPublicUser(id)); return authors.get(id)!; };
  const result = await Promise.all(posts.map(async (post): Promise<SocialPost | null> => {
    const data = post.data();
    const [user, liked, likes, comments] = await Promise.all([
      profile(data.userId),
      getDoc(doc(firestore, 'likes', `${viewerId}_${post.id}`)),
      getCountFromServer(query(collection(firestore, 'likes'), where('postId', '==', post.id), limit(50))),
      getCountFromServer(query(collection(firestore, 'comments'), where('postId', '==', post.id), limit(50))),
    ]);
    if (!user) return null;
    return { id: post.id, kind: data.kind, user, title: sanitizeUserText(data.title ?? '', 160), imageUri: data.imageUri ?? null, items: Array.isArray(data.items) ? data.items : [], createdAt: data.createdAt, likeCount: likes.data().count, commentCount: comments.data().count, likedByViewer: liked.exists() };
  }));
  return result.filter((post): post is SocialPost => post !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One cursor page of the public feed. `degraded` means the ordered index is missing and paging stops. */
export async function getFeedPage(viewerId: string, cursor?: QueryDocumentSnapshot): Promise<FeedPage> {
  // Keep this query on single-field indexes so a missing composite index cannot blank Discover.
  // hydrate() sorts the bounded page by createdAt on the client.
  const base = collection(firestore, 'posts');
  const tail = cursor ? [startAfter(cursor)] : [];
  const { snapshot: rows, degraded } = await getDocsWithIndexFallbackInfo(
    query(base, where('isPublic', '==', true), orderBy('createdAt', 'desc'), ...tail, limit(FEED_PAGE_SIZE)),
    query(base, where('isPublic', '==', true), ...tail, limit(FEED_PAGE_SIZE)),
  );
  const excluded = await blocked(viewerId, rows.docs.map((row) => row.data().userId));
  const posts = await hydrate(rows.docs.filter((row) => !excluded.has(row.data().userId)), viewerId);
  return { posts, cursor: !degraded && rows.size === FEED_PAGE_SIZE ? rows.docs[rows.docs.length - 1] : undefined, degraded };
}

export async function getFeedPosts(viewerId: string): Promise<SocialPost[]> {
  return (await getFeedPage(viewerId)).posts;
}

export async function getPublicPostsForUser(userId: string, viewerId: string): Promise<SocialPost[]> {
  const excluded = await blocked(viewerId, [userId]);
  if (excluded.has(userId)) return [];
  const base = collection(firestore, 'posts');
  const rows = await getDocsWithIndexFallback(
    query(base, where('userId', '==', userId), where('isPublic', '==', true), orderBy('createdAt', 'desc'), limit(20)),
    query(base, where('userId', '==', userId), where('isPublic', '==', true), limit(20)),
  );
  return hydrate(rows.docs.filter((row) => row.data().isPublic === true), viewerId);
}
