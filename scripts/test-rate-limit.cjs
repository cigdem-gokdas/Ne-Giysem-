const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../api-worker/src/rateLimiter.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const values = new Map();
const state = {
  blockConcurrencyWhile: (task) => task(),
  storage: {
    get: async (key) => values.get(key),
    put: async (key, value) => { values.set(key, value); },
    delete: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
  },
};
const moduleUnderTest = { exports: {} };
vm.runInNewContext(compiled, { require: name => name === './security' ? { HttpError: Error } : {}, module: moduleUnderTest, exports: moduleUnderTest.exports, Request, Response, URL, Date, crypto: webcrypto });

async function call(limiter, path, requestId) {
  return limiter.fetch(new Request(`https://rate-limit/${path}`, { method: 'POST', body: JSON.stringify(requestId ? { requestId } : {}) }));
}

async function main() {
  const { RateLimiter, RATE_LIMIT_CONSTANTS } = moduleUnderTest.exports;
  assert.equal(RATE_LIMIT_CONSTANTS.COOLDOWN_MS, 8_000);
  const limiter = new RateLimiter(state);
  const reserved = await (await call(limiter, 'reserve')).json();
  assert.ok(reserved.requestId);
  assert.equal((await call(limiter, 'reserve')).status, 429);
  assert.equal((await call(limiter, 'success', reserved.requestId)).status, 200);
  assert.equal(values.get('usage').count, 1);

  values.set('usage', { date: new Date().toISOString().slice(0, 10), count: RATE_LIMIT_CONSTANTS.DAILY_LIMIT, lastRequestAt: 0 });
  assert.equal((await call(limiter, 'reserve')).status, 429);

  values.set('usage', { date: new Date().toISOString().slice(0, 10), count: 7, lastRequestAt: 0 });
  const retry = await (await call(limiter, 'reserve')).json();
  await call(limiter, 'failure', retry.requestId);
  assert.equal(values.get('usage').count, 8);
  assert.ok(values.get('usage').lastRequestAt > 0);
  assert.equal((await call(limiter, 'reserve')).status, 429);
  values.set('usage', { date: new Date().toISOString().slice(0, 10), count: 7, lastRequestAt: Date.now() - 7_000 });
  assert.equal((await call(limiter, 'reserve')).status, 429);
  values.set('usage', { date: new Date().toISOString().slice(0, 10), count: 7, lastRequestAt: Date.now() - 9_000 });
  assert.equal((await call(limiter, 'reserve')).status, 200);
  values.set('usage', { date: new Date().toISOString().slice(0, 10), count: 7, lastRequestAt: Date.now() - 70_000, pending: { id: 'stale', previousDate: new Date().toISOString().slice(0, 10), previousCount: 7, previousLastRequestAt: 0 } });
  assert.equal((await call(limiter, 'reserve')).status, 200);
  // S12 generic fixed-window limiter (per-user delete-object, per-IP media).
  const limit = (body) => limiter.fetch(new Request('https://rate-limit/limit', { method: 'POST', body: JSON.stringify(body) }));
  for (let i = 0; i < 3; i++) assert.equal((await limit({ name: 'delete-object', max: 3, windowMs: 60_000 })).status, 200);
  const blocked = await limit({ name: 'delete-object', max: 3, windowMs: 60_000 });
  assert.equal(blocked.status, 429); assert.ok((await blocked.json()).waitSeconds >= 1);
  assert.equal((await limit({ name: 'media', max: 3, windowMs: 60_000 })).status, 200); // independent window per name
  assert.equal((await limit({ name: 'Bad Name', max: 3, windowMs: 60_000 })).status, 400);
  const stored = values.get('limits'); stored['delete-object'].start -= 61_000; values.set('limits', stored);
  assert.equal((await limit({ name: 'delete-object', max: 3, windowMs: 60_000 })).status, 200);
  console.log('Worker Durable Object 8 saniye/25 istek kota kontrolleri geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
