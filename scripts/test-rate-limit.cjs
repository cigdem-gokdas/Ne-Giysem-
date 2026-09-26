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
  },
};
const moduleUnderTest = { exports: {} };
vm.runInNewContext(compiled, { module: moduleUnderTest, exports: moduleUnderTest.exports, Request, Response, URL, Date, crypto: webcrypto });

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
  assert.equal(values.get('usage').count, 7);
  assert.equal(values.get('usage').lastRequestAt, 0);
  values.set('usage', { date: new Date().toISOString().slice(0, 10), count: 7, lastRequestAt: Date.now() - 7_000 });
  assert.equal((await call(limiter, 'reserve')).status, 429);
  values.set('usage', { date: new Date().toISOString().slice(0, 10), count: 7, lastRequestAt: Date.now() - 9_000 });
  assert.equal((await call(limiter, 'reserve')).status, 200);
  values.set('usage', { date: new Date().toISOString().slice(0, 10), count: 7, lastRequestAt: Date.now() - 40_000, pending: { id: 'stale', previousDate: new Date().toISOString().slice(0, 10), previousCount: 7, previousLastRequestAt: 0 } });
  assert.equal((await call(limiter, 'reserve')).status, 200);
  console.log('Worker Durable Object 8 saniye/25 istek kota kontrolleri geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
