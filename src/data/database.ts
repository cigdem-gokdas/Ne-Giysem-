import * as SQLite from 'expo-sqlite';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function initDB(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('ne-giysem.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY NOT NULL,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          password TEXT NOT NULL,
          avatarUri TEXT,
          bio TEXT NOT NULL DEFAULT '',
          share_gallery INTEGER NOT NULL DEFAULT 1,
          share_boards INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS wardrobe (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          imageUri TEXT NOT NULL,
          tur TEXT NOT NULL,
          renk TEXT NOT NULL,
          desen TEXT NOT NULL,
          son_kullanim INTEGER
        );
        CREATE INDEX IF NOT EXISTS wardrobe_user_idx ON wardrobe(user_id);
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          messages_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS chat_sessions_user_idx ON chat_sessions(user_id, createdAt);
        CREATE TABLE IF NOT EXISTS gallery (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          imageUri TEXT NOT NULL,
          note TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          is_public INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS gallery_user_idx ON gallery(user_id, createdAt);
        CREATE TABLE IF NOT EXISTS mood_boards (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          items_json TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          is_public INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS mood_boards_user_idx ON mood_boards(user_id, createdAt);
        CREATE TABLE IF NOT EXISTS outfit_history (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          createdAt TEXT NOT NULL,
          userMessage TEXT NOT NULL,
          assistantMessage TEXT NOT NULL,
          selected_ids_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS outfit_history_user_idx ON outfit_history(user_id, createdAt);
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS api_usage (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date_string TEXT NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0,
          last_request_timestamp INTEGER NOT NULL DEFAULT 0,
          UNIQUE (user_id, date_string)
        );
        CREATE INDEX IF NOT EXISTS api_usage_user_time_idx ON api_usage(user_id, last_request_timestamp);
      `);
      // Existing installations retain their rows; SQLite adds the new fields with defaults.
      for (const [table, columns] of [
        ['users', [
          ['avatarUri', 'TEXT'], ['bio', "TEXT NOT NULL DEFAULT ''"],
          ['share_gallery', 'INTEGER NOT NULL DEFAULT 1'], ['share_boards', 'INTEGER NOT NULL DEFAULT 1'],
        ]],
        ['gallery', [['is_public', 'INTEGER NOT NULL DEFAULT 1']]],
        ['mood_boards', [['is_public', 'INTEGER NOT NULL DEFAULT 1']]],
      ] as const) {
        const existing = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
        for (const [name, definition] of columns) {
          if (!existing.some((column) => column.name === name)) {
            await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
          }
        }
      }
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS follows (
          follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (follower_id, followed_id),
          CHECK (follower_id <> followed_id)
        );
        CREATE INDEX IF NOT EXISTS follows_followed_idx ON follows(followed_id);
      `);
      return db;
    }).catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export const getDB = initDB;
