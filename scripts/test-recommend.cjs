const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(relativePath) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const historyModule = { exports: {} };
vm.runInNewContext(compile('src/data/outfitHistory.ts'), {
  module: historyModule, exports: historyModule.exports,
  require: (name) => {
    if (name === 'firebase/firestore') return { collection: () => ({}), deleteDoc: () => {}, doc: () => ({}), getDocs: () => {}, query: () => ({}), setDoc: () => {}, where: () => ({}) };
    if (name === '../config/firebase') return { firestore: {} };
    throw new Error(`Unexpected history import: ${name}`);
  },
});
const historyData = historyModule.exports;

function load(workerPost) {
  const module = { exports: {} };
  vm.runInNewContext(compile('src/services/recommendOutfit.ts'), {
    module, exports: module.exports,
    require: (name) => {
      if (name === '../data/outfitHistory') return historyData;
      if (name === './workerApi') return { workerPost };
      throw new Error(`Unexpected service import: ${name}`);
    },
  });
  return module.exports;
}

const wardrobe = [
  { id: '123', imageUri: 'private-photo', tags: { tur: 'Üst', renk: 'bordo', desen: 'düz' } },
  { id: '456', imageUri: 'private-photo', tags: { tur: 'ayakkabı', renk: 'siyah', desen: 'düz' } },
  { id: '789', imageUri: 'private-photo', tags: { tur: 'alt', renk: 'lacivert', desen: 'çizgili' } },
  { id: '321', imageUri: 'private-photo', tags: { tur: 'aksesuar', renk: 'zümrüt', desen: 'düz' } },
];
const earlier = { id: 'old', createdAt: '2026-09-20T10:00:00.000Z', userMessage: 'Eski plan', assistantMessage: 'Eski yorum', selectedIds: ['123', '456'] };

async function main() {
  assert.equal(historyData.buildWardrobeSummary(wardrobe, [earlier]).find((item) => item.id === '123').son_kullanim, 0);
  const service = load(async (userId, endpoint, body) => {
    assert.equal(userId, 'user-1');
    assert.equal(endpoint, '/generate-outfit');
    assert.equal(body.message, 'Daha spor olsun');
    assert.equal(JSON.stringify(body).includes('imageUri'), false);
    assert.equal(JSON.stringify(body).includes('desen'), false);
    assert.deepEqual(Array.from(body.wardrobe, (item) => ({ ...item })), [
      { id: '789', tur: 'alt', renk: 'lacivert', kesim: 'bilinmiyor', alt_tur: 'diğer', kemer_uygun: false, son_kullanim: 'hic', kullanim_sayisi: 0 },
      { id: '321', tur: 'aksesuar', renk: 'zümrüt', kesim: 'bilinmiyor', alt_tur: 'diğer', kemer_uygun: false, son_kullanim: 'hic', kullanim_sayisi: 0 },
    ]);
    return { recommendation: { mesaj: 'Bu parçalar çok yakışır.', secilen_idler: ['789', '321'] } };
  });
  const result = await service.recommendOutfit('user-1', 'Daha spor olsun', wardrobe, [earlier]);
  assert.deepEqual(Array.from(result.secilen_idler), ['789', '321']);
  assert.equal(service.isReplacementRequest('Gömlek kirli'), true);

  const exchangeWardrobe = [...wardrobe, { id: '654', imageUri: 'private-photo', tags: { tur: 'ayakkabı', renk: 'bordo', desen: 'düz' } }];
  const replacement = { previousIds: ['123', '456'], replaceId: '456' };
  const exchange = load(async (_uid, endpoint, body) => {
    assert.equal(endpoint, '/generate-outfit');
    assert.equal(body.message.includes('Değişecek ID: 456'), true);
    assert.deepEqual(Array.from(body.wardrobe, (item) => item.id), ['123', '456', '654']);
    return { recommendation: { mesaj: 'Bordo ayakkabı iyi gider.', secilen_idler: ['654', '123'] } };
  });
  const exchanged = await exchange.recommendOutfit('user-1', 'Ayakkabı kirli', exchangeWardrobe, [earlier], undefined, replacement);
  assert.deepEqual(Array.from(exchanged.secilen_idler), ['123', '654']);

  const invalid = load(async () => ({ recommendation: { mesaj: 'Olmaz.', secilen_idler: ['789', '654'] } }));
  await assert.rejects(() => invalid.recommendOutfit('user-1', 'Ayakkabı kirli', exchangeWardrobe, [earlier], undefined, replacement), /yalnızca değiştirilecek parçayı/);
  console.log('Worker kombin sözleşmesi, kullanım rotasyonu, soğuma ve ekonomik değişim kontrolleri geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
