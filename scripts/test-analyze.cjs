const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/services/analyzeClothing.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadWithFetch(fetchMock) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    fetch: fetchMock,
    require: (name) => {
      if (name === '../config/env') return { OPENAI_API_KEY: 'test-key' };
      if (name === './rateLimiter') return { withApiRateLimit: (_userId, request) => request() };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return module.exports.analyzeClothing;
}

async function main() {
  const analyze = loadWithFetch(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'gpt-5.6-luna');
    assert.equal(request.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,ZmFrZQ==');
    assert.equal(request.response_format.type, 'json_schema');
    return {
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: '{"tur":"üst","renk":"Kahverengi","desen":"Düz"}' } }],
      }),
    };
  });
  const tags = await analyze('user-1', 'ZmFrZQ==');
  assert.equal(tags.tur, 'üst');
  assert.equal(tags.renk, 'Kahverengi');
  assert.equal(tags.desen, 'Düz');

  const invalid = loadWithFetch(async () => ({
    ok: true,
    json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"tur":"şapka","renk":"","desen":"Düz"}' } }] }),
  }));
  await assert.rejects(() => invalid('user-1', 'ZmFrZQ=='), /Invalid tag response/);
  console.log('Analiz isteği ve JSON doğrulaması geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
