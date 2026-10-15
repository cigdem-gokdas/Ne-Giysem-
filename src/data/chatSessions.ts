import { forEachPage } from './paging';
import { limitedSet, limitedUpdate } from './writeBudget';
import { limit, orderBy, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { getDocsWithIndexFallback } from './firestoreQuery';
import { firestore } from '../config/firebase';

export type ChatSessionMessage =
  | { id: string; role: 'user'; text: string; createdAt: string }
  | { id: string; role: 'assistant'; text: string; selectedIds: string[]; createdAt: string };
export type ChatSession = { id: string; title: string; createdAt: string; messages: ChatSessionMessage[] };

function makeId(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

export function sessionTitle(text: string): string {
  const sentence = text.trim().replace(/\s+/g, ' ').split(/[.!?\n]/, 1)[0];
  return sentence.length > 34 ? `${sentence.slice(0, 33).trimEnd()}…` : sentence || 'Yeni sohbet';
}

export async function getChatSessions(userId: string): Promise<ChatSession[]> {
  const base = collection(firestore, 'chat_sessions');
  const rows = await getDocsWithIndexFallback(query(base, where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(20)), query(base, where('userId', '==', userId), limit(20)));
  return rows.docs.map((row) => ({ id: row.id, title: row.data().title, createdAt: row.data().createdAt, messages: Array.isArray(row.data().messages) ? row.data().messages : [] }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteChatSession(userId: string, sessionId: string): Promise<void> {
  const ref = doc(firestore, 'chat_sessions', sessionId);
  const row = await getDoc(ref);
  if (!row.exists() || row.data().userId !== userId) throw new Error('Sohbet bulunamadı veya silme yetkin yok.');
  const batch = writeBatch(firestore);
  batch.delete(ref);
  await batch.commit();
}

export async function clearChatSessions(userId: string): Promise<void> {
  await forEachPage(query(collection(firestore, 'chat_sessions'), where('userId', '==', userId)), async (rows) => {
    const batch = writeBatch(firestore);
    rows.forEach((row) => batch.delete(row.ref));
    await batch.commit();
  }, 20);
}

export async function appendChatMessage(
  userId: string,
  sessionId: string | null,
  message: { role: 'user'; text: string } | { role: 'assistant'; text: string; selectedIds: string[] },
): Promise<{ session: ChatSession }> {
  if (!message.text.trim() || message.text.length > 1500) throw new Error('Mesaj 1–1500 karakter olmalı.');
  const saved = { ...message, id: makeId(), createdAt: new Date().toISOString() } as ChatSessionMessage;
  let session: ChatSession;
  if (!sessionId) {
    if (message.role !== 'user') throw new Error('Yeni sohbet kullanıcı mesajıyla başlamalı.');
    const ref = doc(collection(firestore, 'chat_sessions'));
    session = { id: ref.id, title: sessionTitle(message.text), createdAt: saved.createdAt, messages: [saved] };
    await limitedSet(ref, { userId, title: session.title, createdAt: session.createdAt, messages: session.messages });
  } else {
    const ref = doc(firestore, 'chat_sessions', sessionId);
    const row = await getDoc(ref);
    if (!row.exists() || row.data().userId !== userId) throw new Error('Sohbet bulunamadı.');
    session = { id: ref.id, title: row.data().title, createdAt: row.data().createdAt, messages: [...(row.data().messages ?? []).slice(-49), saved] };
    await limitedUpdate(ref, { messages: session.messages });
  }
  return { session };
}
