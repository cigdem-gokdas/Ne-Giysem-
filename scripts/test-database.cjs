const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');

const sqlite = new DatabaseSync(':memory:');
const db = {
  execAsync: async (sql) => { sqlite.exec(sql); },
  runAsync: async (sql, ...params) => {
    const result = sqlite.prepare(sql).run(...params);
    return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
  },
  getFirstAsync: async (sql, ...params) => sqlite.prepare(sql).get(...params) ?? null,
  getAllAsync: async (sql, ...params) => sqlite.prepare(sql).all(...params),
  withExclusiveTransactionAsync: async (task) => {
    sqlite.exec('BEGIN');
    try { await task(db); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const legacy = new Map();
const asyncStorage = {
  multiGet: async (keys) => keys.map((key) => [key, legacy.get(key) ?? null]),
  multiRemove: async (keys) => keys.forEach((key) => legacy.delete(key)),
};
const files = new Set();
class Directory {
  constructor(_root, name) { this.uri = `file:///docs/${name}`; }
  create() {}
}
class File {
  constructor(first, second) {
    this.uri = second ? `${first.uri}/${second}` : first;
    this.extension = path.extname(this.uri);
  }
  get exists() { return files.has(this.uri); }
  async copy(destination) { files.add(destination.uri); }
  delete() { files.delete(this.uri); }
}
const mocks = {
  'expo-sqlite': { openDatabaseAsync: async () => db },
  'expo-file-system': { Directory, File, Paths: { document: 'file:///docs' } },
  'expo-crypto': {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync: async (_algorithm, value) => crypto.createHash('sha256').update(value).digest('hex'),
    getRandomBytesAsync: async (count) => crypto.randomBytes(count),
    randomUUID: crypto.randomUUID,
  },
  '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorage },
};
const cache = new Map();
function load(relativePath) {
  const fullPath = path.resolve(__dirname, '../src/data', relativePath);
  if (cache.has(fullPath)) return cache.get(fullPath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  cache.set(fullPath, module.exports);
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console,
    require: (id) => {
      if (id.startsWith('.')) return load(path.relative(path.resolve(__dirname, '../src/data'), path.resolve(path.dirname(fullPath), id)) + '.ts');
      if (mocks[id]) return mocks[id];
      throw new Error(`Unexpected import: ${id}`);
    },
  }, { filename: fullPath });
  return module.exports;
}

async function main() {
  const auth = load('auth.ts');
  const database = load('database.ts');
  const migration = load('legacyMigration.ts');
  const wardrobe = load('wardrobe.ts');
  const chat = load('chatSessions.ts');
  const gallery = load('outfitGallery.ts');
  const history = load('outfitHistory.ts');
  const moodBoards = load('moodBoards.ts');
  const social = load('social.ts');
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL);
    CREATE TABLE gallery (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, imageUri TEXT NOT NULL, note TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE mood_boards (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, title TEXT NOT NULL, items_json TEXT NOT NULL, createdAt TEXT NOT NULL);
    INSERT INTO users (id, username, password) VALUES ('older-user', 'Eski', 'old-password');
    INSERT INTO gallery (id, user_id, imageUri, note, createdAt) VALUES ('older-photo', 'older-user', 'file:///docs/outfit-gallery/older.jpg', 'Eski not', '2025-01-01T00:00:00.000Z');
  `);
  await database.initDB();

  for (const table of ['users', 'wardrobe', 'chat_sessions', 'gallery', 'mood_boards', 'follows', 'api_usage']) {
    assert.ok(sqlite.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', table));
  }
  assert.equal(sqlite.prepare('SELECT is_public FROM gallery WHERE id = ?').get('older-photo').is_public, 1);
  for (const column of ['avatarUri', 'bio', 'share_gallery', 'share_boards']) {
    assert.ok(sqlite.prepare('PRAGMA table_info(users)').all().some((row) => row.name === column));
  }
  const oldClothing = { id: 'old-coat', imageUri: 'file:///docs/wardrobe-photos/old-coat.jpg', tags: { tur: 'dış giyim', renk: 'bordo', desen: 'düz' } };
  const oldOutfit = { id: 'old-outfit', createdAt: '2026-09-20T10:00:00.000Z', userMessage: 'Kahveye gidiyorum', assistantMessage: 'Bordo ceket güzel.', selectedIds: ['old-coat'] };
  const oldPhoto = { id: 'old-photo', imageUri: 'file:///docs/outfit-gallery/old-photo.jpg', note: 'Kahve günü', createdAt: '2026-09-20T11:00:00.000Z' };
  legacy.set('@ne-giysem/wardrobe:v1', JSON.stringify([oldClothing]));
  legacy.set('outfit_history', JSON.stringify([oldOutfit]));
  legacy.set('outfit_gallery', JSON.stringify([oldPhoto]));
  files.add(oldClothing.imageUri);
  files.add(oldPhoto.imageUri);

  const first = await auth.registerUser('  Cigdem  ', 'secret123');
  assert.equal(first.username, 'Cigdem');
  await migration.migrateLegacyDataForUser(first.id);
  await migration.migrateLegacyDataForUser(first.id);
  assert.equal(legacy.size, 0);
  assert.equal((await wardrobe.getClothingItems(first.id)).length, 1);
  assert.equal((await chat.getChatSessions(first.id))[0].messages.length, 2);
  assert.equal((await gallery.getGalleryEntries(first.id))[0].note, 'Kahve günü');
  assert.equal((await history.getOutfitHistory(first.id)).length, 1);
  assert.equal(sqlite.prepare('SELECT son_kullanim FROM wardrobe WHERE id = ?').get('old-coat').son_kullanim, 0);
  await assert.rejects(() => auth.signInUser('Cigdem', 'wrong'), /hatalı/);
  assert.equal((await auth.signInUser('cigdem', 'secret123')).id, first.id);
  await assert.rejects(() => auth.registerUser('CIGDEM', 'otherpass'), /kayıtlı/);

  const second = await auth.registerUser('Derya', 'secret456');
  await migration.migrateLegacyDataForUser(second.id);
  assert.equal((await wardrobe.getClothingItems(second.id)).length, 0);
  assert.equal((await chat.getChatSessions(second.id)).length, 0);
  assert.equal((await gallery.getGalleryEntries(second.id)).length, 0);
  await assert.rejects(() => wardrobe.updateClothingTags(second.id, 'old-coat', { tur: 'üst', renk: 'siyah', desen: 'düz' }), /bulunamadı/);
  await assert.rejects(() => wardrobe.deleteClothingItem(second.id, 'old-coat'), /bulunamadı/);
  await assert.rejects(() => gallery.deleteGalleryEntry(second.id, 'old-photo'), /bulunamadı/);

  const created = await chat.appendChatMessage(first.id, null, { role: 'user', text: 'Yağmurlu gün kombini?' });
  await chat.appendChatMessage(first.id, created.session.id, { role: 'assistant', text: 'Ceket ve bot güzel.', selectedIds: ['old-coat'] });
  await assert.rejects(() => chat.appendChatMessage(second.id, created.session.id, { role: 'user', text: 'Merhaba' }), /bulunamadı/);
  assert.equal((await chat.getChatSessions(first.id)).length, 2);
  assert.equal((await chat.getChatSessions(second.id)).length, 0);

  const newItem = await wardrobe.addClothingItem(second.id, 'file:///cache/shirt.jpg', { tur: 'üst', renk: 'sage', desen: 'düz' });
  assert.equal((await wardrobe.getClothingItems(first.id)).length, 1);
  const firstBoard = await moodBoards.createMoodBoard(first.id, '  Pazar   Kahvesi  ', ['old-coat', 'old-coat']);
  assert.equal(firstBoard.title, 'Pazar Kahvesi');
  assert.deepEqual(Array.from(firstBoard.itemIds), ['old-coat']);
  assert.equal((await moodBoards.getMoodBoards(first.id))[0].id, firstBoard.id);
  assert.equal((await moodBoards.getMoodBoards(second.id)).length, 0);
  assert.deepEqual(JSON.parse(sqlite.prepare('SELECT items_json FROM mood_boards WHERE id = ?').get(firstBoard.id).items_json), ['old-coat']);
  await assert.rejects(() => moodBoards.createMoodBoard(second.id, 'Başka kullanıcı', ['old-coat']), /bulunamadı/);
  await assert.rejects(() => moodBoards.deleteMoodBoard(second.id, firstBoard.id), /bulunamadı/);
  const secondBoard = await moodBoards.createMoodBoard(second.id, '', [newItem.id]);
  assert.equal(secondBoard.title, 'Benim ilham panom');
  const newPhoto = await gallery.addGalleryEntry(second.id, 'file:///cache/look.jpg', '  Okul kombini  ');
  assert.equal(newPhoto.note, 'Okul kombini');
  assert.equal(newPhoto.isPublic, true);
  assert.equal((await social.getFeedPosts(second.id)).length, 2);
  await social.setFollowing(second.id, first.id, true);
  assert.equal(await social.isFollowing(second.id, first.id), true);
  const followedFeed = await social.getFeedPosts(second.id);
  assert.equal(followedFeed.length, 2);
  assert.equal(followedFeed.every((post) => post.user.id === first.id), true);
  assert.equal(followedFeed.find((post) => post.kind === 'board').items[0].id, 'old-coat');
  assert.equal((await social.getPublicPostsForUser(first.id)).length, 2);
  await social.updateBio(first.id, 'Vintage stil ve kahve');
  assert.equal((await social.getPublicUser(first.id)).bio, 'Vintage stil ve kahve');
  await social.setShareSetting(first.id, 'gallery', false);
  assert.equal((await social.getPublicPostsForUser(first.id)).length, 1);
  await social.setShareSetting(first.id, 'boards', false);
  assert.equal((await social.getPublicPostsForUser(first.id)).length, 0);
  assert.equal((await social.getFeedPosts(second.id)).every((post) => post.user.id === second.id), true);
  assert.equal((await gallery.getGalleryEntries(first.id))[0].isPublic, false);
  assert.equal((await moodBoards.getMoodBoards(first.id))[0].isPublic, false);
  await social.setShareSetting(second.id, 'boards', false);
  const hiddenBoard = await moodBoards.createMoodBoard(second.id, 'Gizli', [newItem.id]);
  assert.equal(hiddenBoard.isPublic, false);
  await social.setShareSetting(second.id, 'gallery', false);
  const hiddenPhoto = await gallery.addGalleryEntry(second.id, 'file:///cache/hidden.jpg', 'Gizli');
  assert.equal(hiddenPhoto.isPublic, false);
  assert.equal((await social.getPublicPostsForUser(second.id)).length, 0);
  await social.setShareSetting(second.id, 'gallery', true);
  await social.setShareSetting(second.id, 'boards', true);
  assert.equal((await social.getPublicPostsForUser(second.id)).length, 4);
  await moodBoards.deleteMoodBoard(second.id, hiddenBoard.id);
  assert.equal((await moodBoards.getMoodBoards(second.id)).length, 1);
  assert.equal((await social.getPublicPostsForUser(second.id)).length, 3);
  await social.setFollowing(second.id, first.id, false);
  assert.equal(await social.isFollowing(second.id, first.id), false);
  assert.equal(files.has(newPhoto.imageUri), true);
  await gallery.deleteGalleryEntry(second.id, newPhoto.id);
  assert.equal(files.has(newPhoto.imageUri), false);
  assert.equal((await gallery.getGalleryEntries(second.id)).length, 1);
  await gallery.deleteGalleryEntry(second.id, hiddenPhoto.id);
  assert.equal((await gallery.getGalleryEntries(second.id)).length, 0);
  assert.equal((await gallery.getGalleryEntries(first.id)).length, 1);

  await history.saveOutfitHistoryEntry(first.id, { userMessage: 'Yeni plan', assistantMessage: 'Bir öneri', selectedIds: ['old-coat'] });
  assert.equal((await history.getOutfitHistory(first.id)).length, 2);
  assert.equal((await history.getOutfitHistory(second.id)).length, 0);
  assert.equal(sqlite.prepare('SELECT son_kullanim FROM wardrobe WHERE id = ?').get('old-coat').son_kullanim, 0);
  await wardrobe.resetLocalData(second.id);
  assert.equal(files.has(newItem.imageUri), false);
  assert.equal((await moodBoards.getMoodBoards(second.id)).length, 0);
  assert.equal((await moodBoards.getMoodBoards(first.id))[0].id, firstBoard.id);
  assert.equal((await wardrobe.getClothingItems(first.id)).length, 1);
  assert.equal((await gallery.getGalleryEntries(first.id)).length, 1);
  await gallery.deleteGalleryEntry(first.id, 'old-photo');
  assert.equal(files.has(oldPhoto.imageUri), false);
  console.log('SQLite şema geçişi, kullanıcı izolasyonu, Keşfet, takip, gizlilik, galeri ve ilham panosu silme geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
