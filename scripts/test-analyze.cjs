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
      if (name === './aiConsent') return { requireAiConsent: async () => {} };
      if (name === './writeBudget') return {};
      if (name === './paging') return {};
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
  const { tags, subjectBox } = await analyze('user-1', 'ZmFrZQ==');
  assert.equal(subjectBox, null);
  assert.deepEqual(JSON.parse(JSON.stringify(tags)), { tur: 'üst', renk: 'Kahverengi', desen: 'Düz', kesim: 'bilinmiyor', altTur: 'diğer', kemerUygun: false, secondaryColors: [], season: [], styleTags: [], formality: 'bilinmiyor', materialGuess: 'bilinmiyor' });

  const boxed = load(async () => ({ tags: { tur: 'üst', renk: 'Mavi', desen: 'Düz', subjectBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } } }));
  assert.deepEqual(JSON.parse(JSON.stringify((await boxed('user-1', 'ZmFrZQ==')).subjectBox)), { x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
  const badBox = load(async () => ({ tags: { tur: 'üst', renk: 'Mavi', desen: 'Düz', subjectBox: { x: 0.8, y: 0.2, width: 0.5, height: 0.6 } } }));
  assert.equal((await badBox('user-1', 'ZmFrZQ==')).subjectBox, null);

  await assert.rejects(() => analyze('user-1', ''), /Fotoğraf verisi okunamadı/);

  const invalid = load(async () => ({ tags: { tur: 'şapka', renk: '', desen: 'Düz' } }));
  await assert.rejects(() => invalid('user-1', 'ZmFrZQ=='), /etiket yanıtı geçersiz/);
  console.log('Worker görsel analiz sözleşmesi ve JSON doğrulaması geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
