const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(`
  CREATE TABLE users (id TEXT PRIMARY KEY);
  CREATE TABLE api_usage (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date_string TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    last_request_timestamp INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, date_string)
  );
  INSERT INTO users (id) VALUES ('u1'), ('u2'), ('u3');
`);
const db = {
  getFirstAsync: async (sql, ...args) => sqlite.prepare(sql).get(...args) ?? null,
  runAsync: async (sql, ...args) => sqlite.prepare(sql).run(...args),
};
let clockMs = Date.parse('2026-09-22T12:00:00.000Z');
class TestDate extends Date {
  constructor(...args) { if (args.length === 0) super(clockMs); else super(...args); }
  static now() { return clockMs; }
}
function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function load(file, resolve, extras = {}) {
  const module = { exports: {} };
  vm.runInNewContext(compile(file), {
    module, exports: module.exports, Date: TestDate, console,
    require: resolve, ...extras,
  }, { filename: file });
  return module.exports;
}
const limiter = load('src/services/rateLimiter.ts', (name) => {
  if (name === '../data/database') return { getDB: async () => db };
  throw new Error(`Unexpected limiter import: ${name}`);
});
const history = load('src/data/outfitHistory.ts', (name) => {
  if (name === './database') return { getDB: async () => db };
  throw new Error(`Unexpected history import: ${name}`);
});
let fetchCalls = 0;
const fetchMock = async (_url, options) => {
  fetchCalls++;
  const body = JSON.parse(options.body);
  const isVision = Array.isArray(body.messages[1].content);
  return {
    ok: true,
    json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: isVision
      ? '{"tur":"üst","renk":"Kahverengi","desen":"Düz"}'
      : '{"mesaj":"Güzel bir seçim.","secilen_idler":["top","shoes"]}' } }] }),
  };
};
function serviceRequire(name) {
  if (name === '../config/env') return { OPENAI_API_KEY: 'test-key' };
  if (name === './rateLimiter') return limiter;
  if (name === '../data/outfitHistory') return history;
  throw new Error(`Unexpected service import: ${name}`);
}
const vision = load('src/services/analyzeClothing.ts', serviceRequire, { fetch: fetchMock });
const outfit = load('src/services/recommendOutfit.ts', serviceRequire, { fetch: fetchMock });
const wardrobe = [
  { id: 'top', imageUri: 'file:///top.jpg', tags: { tur: 'üst', renk: 'bordo', desen: 'düz' } },
  { id: 'shoes', imageUri: 'file:///shoes.jpg', tags: { tur: 'ayakkabı', renk: 'siyah', desen: 'düz' } },
];
const usage = (user) => sqlite.prepare('SELECT request_count, last_request_timestamp FROM api_usage WHERE user_id = ? ORDER BY last_request_timestamp DESC LIMIT 1').get(user);
const isLimited = (reason) => (error) => error instanceof limiter.RateLimitError && error.reason === reason;

async function main() {
  await limiter.withApiRateLimit('u1', async () => 'ok');
  assert.equal(usage('u1').request_count, 1);
  assert.equal(usage('u1').last_request_timestamp, clockMs);
  await assert.rejects(() => limiter.withApiRateLimit('u1', async () => { throw new Error('Blocked callback ran'); }), isLimited('cooldown'));
  assert.equal(usage('u1').request_count, 1);
  await limiter.withApiRateLimit('u2', async () => 'ok');
  assert.equal(usage('u2').request_count, 1);

  clockMs += 20_000;
  await assert.rejects(() => limiter.withApiRateLimit('u1', async () => { throw new Error('Network failed'); }), /Network failed/);
  assert.equal(usage('u1').request_count, 1);

  let resolvePending;
  const pending = limiter.withApiRateLimit('u1', () => new Promise((resolve) => { resolvePending = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof resolvePending, 'function');
  await assert.rejects(() => limiter.withApiRateLimit('u1', async () => 'second'), isLimited('cooldown'));
  resolvePending('first');
  assert.equal(await pending, 'first');
  assert.equal(usage('u1').request_count, 2);

  sqlite.prepare('UPDATE api_usage SET request_count = 24, last_request_timestamp = ? WHERE user_id = ?').run(clockMs - 20_000, 'u1');
  await limiter.withApiRateLimit('u1', async () => 'twenty-fifth');
  assert.equal(usage('u1').request_count, 25);
  clockMs += 20_000;
  await assert.rejects(() => limiter.withApiRateLimit('u1', async () => { throw new Error('Daily blocked callback ran'); }), isLimited('daily'));

  clockMs += 24 * 60 * 60 * 1000;
  await limiter.withApiRateLimit('u1', async () => 'new day');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM api_usage WHERE user_id = ?').get('u1').count, 2);
  assert.equal(usage('u1').request_count, 1);

  const tags = await vision.analyzeClothing('u2', 'ZmFrZQ==');
  assert.equal(tags.tur, 'üst');
  assert.equal(fetchCalls, 1);
  await assert.rejects(() => outfit.recommendOutfit('u2', 'Kahveye', wardrobe, []), isLimited('cooldown'));
  assert.equal(fetchCalls, 1, 'Cooldown must stop fetch in outfit service');
  clockMs += 20_000;
  await outfit.recommendOutfit('u2', 'Kahveye', wardrobe, []);
  assert.equal(fetchCalls, 2);
  sqlite.prepare('UPDATE api_usage SET request_count = 25 WHERE user_id = ? AND date_string = ?').run('u2', '2026-09-23');
  clockMs += 20_000;
  await assert.rejects(() => vision.analyzeClothing('u2', 'ZmFrZQ=='), isLimited('daily'));
  await assert.rejects(() => outfit.recommendOutfit('u2', 'Kahveye', wardrobe, []), isLimited('daily'));
  assert.equal(fetchCalls, 2, 'Daily limit must stop fetch in both services');
  clockMs += 20_000;
  const invalidVision = load('src/services/analyzeClothing.ts', serviceRequire, { fetch: async () => ({
    ok: true,
    json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"tur":"geçersiz","renk":"","desen":"düz"}' } }] }),
  }) });
  await assert.rejects(() => invalidVision.analyzeClothing('u1', 'ZmFrZQ=='), /Invalid tag response/);
  assert.equal(usage('u1').request_count, 2, 'Successful HTTP response is charged even if its JSON is invalid');
  clockMs += 20_000;
  const failedVision = load('src/services/analyzeClothing.ts', serviceRequire, { fetch: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(() => failedVision.analyzeClothing('u1', 'ZmFrZQ=='), /OpenAI request failed: 503/);
  assert.equal(usage('u1').request_count, 2, 'Failed HTTP response is not charged');

  clockMs = Date.parse('2026-09-23T23:59:55.000Z');
  await limiter.withApiRateLimit('u3', async () => 'before midnight');
  clockMs += 10_000;
  await assert.rejects(() => limiter.withApiRateLimit('u3', async () => 'too soon after midnight'), isLimited('cooldown'));
  console.log('Ortak 20 saniye / 25 günlük limit, kullanıcı ayrımı, eşzamanlılık ve fetch engeli geçti.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
