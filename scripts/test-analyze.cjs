const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/services/analyzeClothing.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function load(workerPost) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => {
      if (name === './workerApi') return { workerPost };
      if (name === '../data/wardrobe') return { FIT_TYPES: ['dar', 'normal', 'bol', 'bilinmiyor'], SUBTYPES: ['tişört', 'gömlek', 'kazak', 'pantolon', 'etek', 'ceket', 'kaban', 'ayakkabı', 'çanta', 'kemer', 'diğer'] };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return module.exports.analyzeClothing;
}

async function main() {
  const analyze = load(async (userId, endpoint, body) => {
    assert.equal(userId, 'user-1');
    assert.equal(endpoint, '/analyze-clothing');
    assert.equal(body.imageBase64, 'ZmFrZQ==');
    assert.equal(body.mimeType, 'image/jpeg');
    return { tags: { tur: 'üst', renk: 'Kahverengi', desen: 'Düz' } };
  });
  const tags = await analyze('user-1', 'ZmFrZQ==');
  assert.deepEqual({ ...tags }, { tur: 'üst', renk: 'Kahverengi', desen: 'Düz', kesim: 'bilinmiyor', altTur: 'diğer', kemerUygun: false });

  await assert.rejects(() => analyze('user-1', ''), /Fotoğraf verisi okunamadı/);

  const invalid = load(async () => ({ tags: { tur: 'şapka', renk: '', desen: 'Düz' } }));
  await assert.rejects(() => invalid('user-1', 'ZmFrZQ=='), /Invalid tag response/);
  console.log('Worker görsel analiz sözleşmesi ve JSON doğrulaması geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
