import * as Crypto from 'expo-crypto';
import { getDB } from './database';

export type MoodBoard = { id: string; title: string; itemIds: string[]; createdAt: string; isPublic: boolean };
type MoodBoardRow = { id: string; title: string; items_json: string; createdAt: string; is_public: number };

function fromRow(row: MoodBoardRow): MoodBoard {
  const itemIds: unknown = JSON.parse(row.items_json);
  if (!Array.isArray(itemIds) || !itemIds.every((id) => typeof id === 'string')) {
    throw new Error('İlham panosu okunamadı.');
  }
  return { id: row.id, title: row.title, itemIds, createdAt: row.createdAt, isPublic: row.is_public === 1 };
}

export async function getMoodBoards(userId: string): Promise<MoodBoard[]> {
  const db = await getDB();
  const rows = await db.getAllAsync<MoodBoardRow>(
    'SELECT id, title, items_json, createdAt, is_public FROM mood_boards WHERE user_id = ? ORDER BY createdAt DESC, rowid DESC',
    userId,
  );
  return rows.map(fromRow);
}

export async function createMoodBoard(userId: string, title: string, itemIds: string[]): Promise<MoodBoard> {
  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length === 0) throw new Error('Panoya en az bir parça seçmelisin.');
  const board: MoodBoard = {
    id: Crypto.randomUUID(),
    title: title.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Benim ilham panom',
    itemIds: uniqueIds,
    createdAt: new Date().toISOString(), isPublic: false,
  };
  const db = await getDB();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const owned = await tx.getAllAsync<{ id: string }>(
      `SELECT id FROM wardrobe WHERE user_id = ? AND id IN (${placeholders})`,
      userId, ...uniqueIds,
    );
    if (owned.length !== uniqueIds.length) throw new Error('Seçilen parçalardan biri gardırobunda bulunamadı.');
    const share = await tx.getFirstAsync<{ share_boards: number }>('SELECT share_boards FROM users WHERE id = ?', userId);
    if (!share) throw new Error('Kullanıcı bulunamadı.');
    await tx.runAsync(
      'INSERT INTO mood_boards (id, user_id, title, items_json, createdAt, is_public) VALUES (?, ?, ?, ?, ?, ?)',
      board.id, userId, board.title, JSON.stringify(board.itemIds), board.createdAt, share.share_boards,
    );
    board.isPublic = share.share_boards === 1;
  });
  return board;
}

export async function deleteMoodBoard(userId: string, id: string): Promise<void> {
  const db = await getDB();
  const result = await db.runAsync('DELETE FROM mood_boards WHERE id = ? AND user_id = ?', id, userId);
  if (result.changes !== 1) throw new Error('İlham panosu bulunamadı.');
}
