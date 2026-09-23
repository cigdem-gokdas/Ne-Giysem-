import * as SQLite from 'expo-sqlite';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export const DATABASE_NAME = 'ne-giysem.db';

async function hasColumn(db: SQLite.SQLiteDatabase, table: string, column: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ name: string }>(
    'SELECT name FROM pragma_table_info(?) WHERE name = ?', table, column,
  );
  return !!row;
}

async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  alterStatement: string,
): Promise<void> {
  if (!(await hasColumn(db, table, column))) await db.execAsync(alterStatement);
}

export function initDB(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY NOT NULL,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          password TEXT NOT NULL,
          email TEXT,
          auth_provider TEXT NOT NULL DEFAULT 'local',
          google_sub TEXT,
          avatarUri TEXT,
          avatar_uri TEXT,
          bio TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
          terms_accepted_at TEXT,
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
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          messages_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS gallery (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          imageUri TEXT NOT NULL,
          note TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          is_public INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS mood_boards (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          items_json TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          is_public INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS outfit_history (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          createdAt TEXT NOT NULL,
          userMessage TEXT NOT NULL,
          assistantMessage TEXT NOT NULL,
          selected_ids_json TEXT NOT NULL
        );
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
      `);

      // Explicit, constant migrations preserve all older local installations.
      await addColumnIfMissing(db, 'users', 'email', 'ALTER TABLE users ADD COLUMN email TEXT');
      await addColumnIfMissing(db, 'users', 'auth_provider', "ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'");
      await addColumnIfMissing(db, 'users', 'google_sub', 'ALTER TABLE users ADD COLUMN google_sub TEXT');
      await addColumnIfMissing(db, 'users', 'avatarUri', 'ALTER TABLE users ADD COLUMN avatarUri TEXT');
      await addColumnIfMissing(db, 'users', 'avatar_uri', 'ALTER TABLE users ADD COLUMN avatar_uri TEXT');
      await addColumnIfMissing(db, 'users', 'bio', "ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
      await addColumnIfMissing(db, 'users', 'role', "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
      await addColumnIfMissing(db, 'users', 'terms_accepted_at', 'ALTER TABLE users ADD COLUMN terms_accepted_at TEXT');
      await addColumnIfMissing(db, 'users', 'share_gallery', 'ALTER TABLE users ADD COLUMN share_gallery INTEGER NOT NULL DEFAULT 1');
      await addColumnIfMissing(db, 'users', 'share_boards', 'ALTER TABLE users ADD COLUMN share_boards INTEGER NOT NULL DEFAULT 1');
      await addColumnIfMissing(db, 'gallery', 'is_public', 'ALTER TABLE gallery ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1');
      await addColumnIfMissing(db, 'mood_boards', 'is_public', 'ALTER TABLE mood_boards ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1');
      await db.execAsync('UPDATE users SET avatar_uri = avatarUri WHERE avatar_uri IS NULL AND avatarUri IS NOT NULL');

      await db.execAsync(`
        CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users(google_sub) WHERE google_sub IS NOT NULL;
        CREATE INDEX IF NOT EXISTS wardrobe_user_idx ON wardrobe(user_id);
        CREATE INDEX IF NOT EXISTS chat_sessions_user_idx ON chat_sessions(user_id, createdAt);
        CREATE INDEX IF NOT EXISTS gallery_user_idx ON gallery(user_id, createdAt);
        CREATE INDEX IF NOT EXISTS mood_boards_user_idx ON mood_boards(user_id, createdAt);
        CREATE INDEX IF NOT EXISTS outfit_history_user_idx ON outfit_history(user_id, createdAt);
        CREATE INDEX IF NOT EXISTS api_usage_user_time_idx ON api_usage(user_id, last_request_timestamp);
        CREATE TABLE IF NOT EXISTS follows (
          follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (follower_id, followed_id),
          CHECK (follower_id <> followed_id)
        );
        CREATE INDEX IF NOT EXISTS follows_followed_idx ON follows(followed_id);
        CREATE TABLE IF NOT EXISTS likes (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          post_type TEXT NOT NULL CHECK (post_type IN ('gallery', 'board')),
          post_id TEXT NOT NULL,
          UNIQUE (user_id, post_type, post_id)
        );
        CREATE INDEX IF NOT EXISTS likes_post_idx ON likes(post_type, post_id);
        CREATE TABLE IF NOT EXISTS comments (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          post_type TEXT NOT NULL CHECK (post_type IN ('gallery', 'board')),
          post_id TEXT NOT NULL,
          text TEXT NOT NULL,
          createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_type, post_id, createdAt);
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message TEXT NOT NULL,
          is_read INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, is_read, createdAt);
        CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY NOT NULL,
          reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reported_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reason TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          CHECK (reporter_id <> reported_id)
        );
        CREATE INDEX IF NOT EXISTS reports_created_idx ON reports(createdAt);
        CREATE TABLE IF NOT EXISTS blocked_users (
          id TEXT PRIMARY KEY NOT NULL,
          blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE (blocker_id, blocked_id),
          CHECK (blocker_id <> blocked_id)
        );
        CREATE INDEX IF NOT EXISTS blocked_users_pair_idx ON blocked_users(blocker_id, blocked_id);
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

/**
 * Releases the singleton connection before replacing the database file.
 * Normal application code should keep using getDB/initDB.
 */
export async function closeDB(): Promise<void> {
  const current = databasePromise;
  databasePromise = null;
  if (!current) return;
  const db = await current;
  await db.closeAsync();
}
