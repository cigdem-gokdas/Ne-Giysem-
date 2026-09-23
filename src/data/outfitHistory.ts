import { getDB } from './database';
import type { ClothingItem } from './wardrobe';

export type OutfitHistoryEntry = {
  id: string;
  createdAt: string;
  userMessage: string;
  assistantMessage: string;
  selectedIds: string[];
};

export type WardrobeSummaryItem = {
  id: string;
  tur: string;
  renk: string;
  son_kullanim: number | 'hic';
};

type HistoryRow = Omit<OutfitHistoryEntry, 'selectedIds'> & { selected_ids_json: string };
const MAIN_TYPES = new Set(['üst', 'alt', 'dış giyim']);

export function isMainClothingType(type: string): boolean {
  return MAIN_TYPES.has(type.trim().toLocaleLowerCase('tr-TR'));
}

export async function getOutfitHistory(userId: string): Promise<OutfitHistoryEntry[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<HistoryRow>(
    'SELECT id, createdAt, userMessage, assistantMessage, selected_ids_json FROM outfit_history WHERE user_id = ? ORDER BY createdAt ASC, rowid ASC',
    userId,
  );
  return rows.map(({ selected_ids_json, ...row }) => {
    const parsed: unknown = JSON.parse(selected_ids_json);
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) throw new Error('Kombin geçmişi okunamadı.');
    return { ...row, selectedIds: parsed };
  });
}

export async function clearOutfitHistory(userId: string): Promise<void> {
  const db = await getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM outfit_history WHERE user_id = ?', userId);
    await tx.runAsync('UPDATE wardrobe SET son_kullanim = NULL WHERE user_id = ?', userId);
  });
}

export async function saveOutfitHistoryEntry(
  userId: string,
  entry: Omit<OutfitHistoryEntry, 'id' | 'createdAt'>,
): Promise<OutfitHistoryEntry> {
  const saved: OutfitHistoryEntry = {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
  const db = await getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      'INSERT INTO outfit_history (id, user_id, createdAt, userMessage, assistantMessage, selected_ids_json) VALUES (?, ?, ?, ?, ?, ?)',
      saved.id, userId, saved.createdAt, saved.userMessage, saved.assistantMessage, JSON.stringify(saved.selectedIds),
    );
    await tx.runAsync('UPDATE wardrobe SET son_kullanim = son_kullanim + 1 WHERE user_id = ? AND son_kullanim IS NOT NULL', userId);
    for (const id of saved.selectedIds) {
      await tx.runAsync('UPDATE wardrobe SET son_kullanim = 0 WHERE user_id = ? AND id = ?', userId, id);
    }
  });
  return saved;
}

export function buildWardrobeSummary(wardrobe: ClothingItem[], history: OutfitHistoryEntry[]): WardrobeSummaryItem[] {
  const lastUsedIndex = new Map<string, number>();
  history.forEach((entry, index) => entry.selectedIds.forEach((id) => lastUsedIndex.set(id, index)));
  return wardrobe.map(({ id, tags }) => {
    const lastIndex = lastUsedIndex.get(id);
    return {
      id,
      tur: tags.tur,
      renk: tags.renk,
      son_kullanim: lastIndex === undefined ? 'hic' : history.length - 1 - lastIndex,
    };
  });
}

export function hasAvailableMainPiece(summary: WardrobeSummaryItem[]): boolean {
  return summary.some(({ tur, son_kullanim }) =>
    isMainClothingType(tur) && (son_kullanim === 'hic' || son_kullanim >= 5));
}
