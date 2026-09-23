import { getDB } from './database';

export type ChatSessionMessage =
  | { id: string; role: 'user'; text: string; createdAt: string }
  | { id: string; role: 'assistant'; text: string; selectedIds: string[]; createdAt: string };

export type ChatSession = { id: string; title: string; createdAt: string; messages: ChatSessionMessage[] };
type SessionRow = { id: string; title: string; createdAt: string; messages_json: string };

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sessionTitle(firstMessage: string): string {
  const firstSentence = firstMessage.trim().replace(/\s+/g, ' ').split(/[.!?\n]/, 1)[0];
  return firstSentence.length > 34 ? `${firstSentence.slice(0, 33).trimEnd()}…` : firstSentence || 'Yeni sohbet';
}

function isMessage(value: unknown): value is ChatSessionMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ChatSessionMessage>;
  return typeof message.id === 'string'
    && typeof message.text === 'string'
    && typeof message.createdAt === 'string'
    && (message.role === 'user' || (message.role === 'assistant'
      && Array.isArray(message.selectedIds)
      && message.selectedIds.every((id) => typeof id === 'string')));
}

function toSession(row: SessionRow): ChatSession {
  const messages: unknown = JSON.parse(row.messages_json);
  if (!Array.isArray(messages) || !messages.every(isMessage)) throw new Error('Sohbet oturumu okunamadı.');
  return { id: row.id, title: row.title, createdAt: row.createdAt, messages };
}

export async function getChatSessions(userId: string): Promise<ChatSession[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<SessionRow>(
    'SELECT id, title, createdAt, messages_json FROM chat_sessions WHERE user_id = ? ORDER BY createdAt DESC, rowid DESC',
    userId,
  );
  return rows.map(toSession);
}

export async function appendChatMessage(
  userId: string,
  sessionId: string | null,
  message: { role: 'user'; text: string } | { role: 'assistant'; text: string; selectedIds: string[] },
): Promise<{ session: ChatSession; sessions: ChatSession[] }> {
  const db = await getDB();
  const createdAt = new Date().toISOString();
  const savedMessage: ChatSessionMessage = { ...message, id: makeId(), createdAt };
  let session: ChatSession;
  if (sessionId === null) {
    if (message.role !== 'user') throw new Error('Yeni sohbet kullanıcı mesajıyla başlamalı.');
    session = { id: makeId(), title: sessionTitle(message.text), createdAt, messages: [savedMessage] };
    await db.runAsync(
      'INSERT INTO chat_sessions (id, user_id, title, createdAt, messages_json) VALUES (?, ?, ?, ?, ?)',
      session.id, userId, session.title, session.createdAt, JSON.stringify(session.messages),
    );
  } else {
    const row = await db.getFirstAsync<SessionRow>(
      'SELECT id, title, createdAt, messages_json FROM chat_sessions WHERE id = ? AND user_id = ?',
      sessionId, userId,
    );
    if (!row) throw new Error('Sohbet bulunamadı.');
    const current = toSession(row);
    session = { ...current, messages: [...current.messages, savedMessage] };
    const result = await db.runAsync(
      'UPDATE chat_sessions SET messages_json = ? WHERE id = ? AND user_id = ?',
      JSON.stringify(session.messages), sessionId, userId,
    );
    if (result.changes !== 1) throw new Error('Sohbet bulunamadı.');
  }
  return { session, sessions: await getChatSessions(userId) };
}
