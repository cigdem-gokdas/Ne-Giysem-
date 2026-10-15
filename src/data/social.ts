import { forEachPage } from './paging';
import { limitedSet, limitedUpdate } from './writeBudget';
import { limit, orderBy, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDocsWithIndexFallback } from './firestoreQuery';
import { firestore } from '../config/firebase';
import { deleteR2Object, uploadImageToR2, type ImageUploadMetadata } from '../services/r2Storage';
import { sanitizeUserText } from '../utils/sanitize';
import type { ClothingItem } from './wardrobe';

export type PublicUser = { id: string; username: string; avatarUri: string | null; bio: string };
export type ShareSettings = { gallery: boolean; boards: boolean };
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
      getDoc(doc(firestore, 'blocked_users', `${id}_${viewerId}`)),
    ]);
    if (outgoing.exists() || incoming.exists()) excluded.add(id);
  }));
  return excluded;
}

export async function getDiscoverableUsers(viewerId: string): Promise<PublicUser[]> {
  const rows = await getDocs(query(collection(firestore, 'users'), limit(50)));
  const excluded = await blocked(viewerId, rows.docs.map((row) => row.id));
  return rows.docs.filter((row) => row.id !== viewerId && !excluded.has(row.id)).map((row) => ({ id: row.id, username: row.data().username, avatarUri: row.data().avatarUri ?? null, bio: sanitizeUserText(row.data().bio ?? '', 160) })).sort((a, b) => a.username.localeCompare(b.username, 'tr'));
}

export async function updateBio(userId: string, bio: string): Promise<void> {
  await limitedUpdate(doc(firestore, 'users', userId), { bio: sanitizeUserText(bio, 160) });
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

export async function setShareSetting(userId: string, kind: 'gallery' | 'boards', isPublic: boolean): Promise<void> {
  const targetKind = kind === 'gallery' ? 'gallery' : 'board';
  await forEachPage(query(collection(firestore, 'posts'), where('userId', '==', userId)), async (rows) => {
    for (const row of rows.filter((row) => row.data().kind === targetKind && row.data().isPublic !== isPublic)) {
      if (isPublic) await limitedUpdate(row.ref, { isPublic });
      else await updateDoc(row.ref, { isPublic: false }); // Privacy withdrawal must work at the write limit.
    }
  });
  if (kind === 'boards') await forEachPage(query(collection(firestore, 'mood_boards'), where('userId', '==', userId)), async (rows) => {
    for (const row of rows.filter((row) => row.data().isPublic !== isPublic)) {
      if (isPublic) await limitedUpdate(row.ref, { isPublic }); else await updateDoc(row.ref, { isPublic: false });
    }
  });
  const data = { [kind === 'gallery' ? 'shareGallery' : 'shareBoards']: isPublic };
  if (isPublic) await limitedUpdate(doc(firestore, 'users', userId), data);
  else await updateDoc(doc(firestore, 'users', userId), data);
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
    getDoc(doc(firestore, 'blocked_users', `${followedId}_${followerId}`)),
  ]);
  if (!user.exists()) throw new Error('Kullanıcı bulunamadı.');
  if (outgoing.exists() || incoming.exists()) throw new Error('Bu kullanıcıyı takip edemezsin.');
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

export async function getFeedPosts(viewerId: string): Promise<SocialPost[]> {
  // Keep this query on single-field indexes so a missing composite index cannot blank Discover.
  // hydrate() sorts the bounded result by createdAt on the client.
  const base = collection(firestore, 'posts');
  const rows = await getDocsWithIndexFallback(
    query(base, where('isPublic', '==', true), orderBy('createdAt', 'desc'), limit(20)),
    query(base, where('isPublic', '==', true), limit(20)),
  );
  const excluded = await blocked(viewerId, rows.docs.map((row) => row.data().userId));
  return hydrate(rows.docs.filter((row) => !excluded.has(row.data().userId)), viewerId);
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
