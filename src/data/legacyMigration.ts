import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDB } from './database';
import type { ChatSession, ChatSessionMessage } from './chatSessions';
import type { GalleryEntry } from './outfitGallery';
import type { OutfitHistoryEntry } from './outfitHistory';
import type { ClothingItem } from './wardrobe';

const legacyKeys = ['@ne-giysem/wardrobe:v1', 'outfit_history', 'chat_sessions', 'outfit_gallery'] as const;
const migrationKey = 'legacy_async_storage_migrated';

function parseArray(value: string | null): unknown[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Eski yerel veri okunamadı.');
  return parsed;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readWardrobe(value: unknown): ClothingItem | null {
  const item = asObject(value);
  const tags = asObject(item?.tags);
  return item && tags && typeof item.id === 'string' && typeof item.imageUri === 'string'
    && typeof tags.tur === 'string' && typeof tags.renk === 'string' && typeof tags.desen === 'string'
    ? { id: item.id, imageUri: item.imageUri, tags: { tur: tags.tur, renk: tags.renk, desen: tags.desen } } : null;
}

function readHistory(value: unknown): OutfitHistoryEntry | null {
  const row = asObject(value);
  return row && typeof row.id === 'string' && typeof row.createdAt === 'string'
    && typeof row.userMessage === 'string' && typeof row.assistantMessage === 'string'
    && Array.isArray(row.selectedIds) && row.selectedIds.every((id) => typeof id === 'string')
    ? { id: row.id, createdAt: row.createdAt, userMessage: row.userMessage, assistantMessage: row.assistantMessage, selectedIds: row.selectedIds } : null;
}

function readMessage(value: unknown): ChatSessionMessage | null {
  const row = asObject(value);
  if (!row || typeof row.id !== 'string' || typeof row.text !== 'string' || typeof row.createdAt !== 'string') return null;
  if (row.role === 'user') return { id: row.id, role: 'user', text: row.text, createdAt: row.createdAt };
  if (row.role === 'assistant' && Array.isArray(row.selectedIds) && row.selectedIds.every((id) => typeof id === 'string')) {
    return { id: row.id, role: 'assistant', text: row.text, selectedIds: row.selectedIds, createdAt: row.createdAt };
  }
  return null;
}

function readSession(value: unknown): ChatSession | null {
  const row = asObject(value);
  if (!row || typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.createdAt !== 'string' || !Array.isArray(row.messages)) return null;
  const messages = row.messages.map(readMessage);
  return messages.every((message) => message !== null)
    ? { id: row.id, title: row.title, createdAt: row.createdAt, messages: messages as ChatSessionMessage[] } : null;
}

function readGallery(value: unknown): GalleryEntry | null {
  const row = asObject(value);
  return row && typeof row.id === 'string' && typeof row.imageUri === 'string'
    && typeof row.note === 'string' && typeof row.createdAt === 'string'
    ? { id: row.id, imageUri: row.imageUri, note: row.note, createdAt: row.createdAt, isPublic: true } : null;
}

export async function migrateLegacyDataForUser(userId: string): Promise<void> {
  const db = await getDB();
  const marker = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', migrationKey);
  if (marker) return;

  const values = await AsyncStorage.multiGet([...legacyKeys]);
  const byKey = new Map(values);
  const wardrobe = parseArray(byKey.get(legacyKeys[0]) ?? null).map(readWardrobe).filter((item): item is ClothingItem => item !== null);
  const history = parseArray(byKey.get(legacyKeys[1]) ?? null).map(readHistory).filter((item): item is OutfitHistoryEntry => item !== null);
  const sessions = parseArray(byKey.get(legacyKeys[2]) ?? null).map(readSession).filter((item): item is ChatSession => item !== null);
  const gallery = parseArray(byKey.get(legacyKeys[3]) ?? null).map(readGallery).filter((item): item is GalleryEntry => item !== null);

  if (sessions.length === 0 && history.length > 0) {
    sessions.push({
      id: `legacy-${history[0].id}`,
      title: history[0].userMessage.slice(0, 34),
      createdAt: history[0].createdAt,
      messages: history.flatMap((entry) => [
        { id: `${entry.id}-user`, role: 'user' as const, text: entry.userMessage, createdAt: entry.createdAt },
        { id: `${entry.id}-assistant`, role: 'assistant' as const, text: entry.assistantMessage, selectedIds: entry.selectedIds, createdAt: entry.createdAt },
      ]),
    });
  }

  const lastUse = new Map<string, number>();
  history.forEach((entry, index) => entry.selectedIds.forEach((id) => lastUse.set(id, history.length - index - 1)));
  await db.withExclusiveTransactionAsync(async (tx) => {
    const alreadyDone = await tx.getFirstAsync('SELECT 1 FROM app_meta WHERE key = ?', migrationKey);
    if (alreadyDone) return;
    for (const item of wardrobe) {
      await tx.runAsync(
        'INSERT OR IGNORE INTO wardrobe (id, user_id, imageUri, tur, renk, desen, son_kullanim) VALUES (?, ?, ?, ?, ?, ?, ?)',
        item.id, userId, item.imageUri, item.tags.tur, item.tags.renk, item.tags.desen, lastUse.get(item.id) ?? null,
      );
    }
    for (const session of sessions) {
      await tx.runAsync(
        'INSERT OR IGNORE INTO chat_sessions (id, user_id, title, createdAt, messages_json) VALUES (?, ?, ?, ?, ?)',
        session.id, userId, session.title, session.createdAt, JSON.stringify(session.messages),
      );
    }
    for (const entry of gallery) {
      await tx.runAsync(
        'INSERT OR IGNORE INTO gallery (id, user_id, imageUri, note, createdAt) VALUES (?, ?, ?, ?, ?)',
        entry.id, userId, entry.imageUri, entry.note, entry.createdAt,
      );
    }
    for (const entry of history) {
      await tx.runAsync(
        'INSERT OR IGNORE INTO outfit_history (id, user_id, createdAt, userMessage, assistantMessage, selected_ids_json) VALUES (?, ?, ?, ?, ?, ?)',
        entry.id, userId, entry.createdAt, entry.userMessage, entry.assistantMessage, JSON.stringify(entry.selectedIds),
      );
    }
    await tx.runAsync('INSERT INTO app_meta (key, value) VALUES (?, ?)', migrationKey, userId);
  });
  try { await AsyncStorage.multiRemove([...legacyKeys]); } catch { /* SQLite is already the source of truth. */ }
}
