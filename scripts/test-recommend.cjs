const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

const historyModule = { exports: {} };
vm.runInNewContext(compile('src/data/outfitHistory.ts'), {
  module: historyModule,
  exports: historyModule.exports,
  require: (name) => {
    if (name === './database') return { getDB: async () => { throw new Error('Bu testte veritabanı kullanılmaz.'); } };
    throw new Error(`Unexpected history import: ${name}`);
  },
});
const historyData = historyModule.exports;

function loadWithFetch(fetchMock) {
  const module = { exports: {} };
  vm.runInNewContext(compile('src/services/recommendOutfit.ts'), {
    module,
    exports: module.exports,
    fetch: fetchMock,
    require: (name) => {
      if (name === '../config/env') return { OPENAI_API_KEY: 'test-key' };
      if (name === '../data/outfitHistory') return historyData;
      if (name === './rateLimiter') return { withApiRateLimit: (_userId, request) => request() };
      throw new Error(`Unexpected service import: ${name}`);
    },
  });
  return module.exports;
}

const wardrobe = [
  { id: '123', imageUri: 'file:///private/photo-123.jpg', tags: { tur: 'Üst', renk: 'bordo', desen: 'düz' } },
  { id: '456', imageUri: 'file:///private/photo-456.jpg', tags: { tur: 'ayakkabı', renk: 'siyah', desen: 'düz' } },
  { id: '789', imageUri: 'file:///private/photo-789.jpg', tags: { tur: 'alt', renk: 'lacivert', desen: 'çizgili' } },
];
const earlier = {
  id: 'old', createdAt: '2026-09-20T10:00:00.000Z', userMessage: 'Eski bir plan',
  assistantMessage: 'Eski stil yorumu', selectedIds: ['123', '456'],
};

async function main() {
  const summary = historyData.buildWardrobeSummary(wardrobe, [earlier]);
  assert.equal(summary.find((item) => item.id === '123').son_kullanim, 0);
  assert.equal(summary.find((item) => item.id === '456').son_kullanim, 0);
  assert.equal(summary.find((item) => item.id === '789').son_kullanim, 'hic');
  const fiveLater = Array.from({ length: 5 }, (_, index) => ({ ...earlier, id: String(index), selectedIds: ['456'] }));
  assert.equal(historyData.buildWardrobeSummary(wardrobe, [earlier, ...fiveLater]).find((item) => item.id === '123').son_kullanim, 5);

  const service = loadWithFetch(async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'gpt-5.6-luna');
    assert.equal(request.store, false);
    assert.equal(request.response_format.type, 'json_schema');
    assert.equal(request.messages.length, 2);
    assert.deepEqual(Array.from(request.messages, (message) => message.role), ['system', 'user']);
    assert.equal(request.messages[1].content, 'Daha spor olsun');
    assert.equal(options.body.includes('file:///'), false);
    assert.equal(options.body.includes('imageUri'), false);
    assert.equal(options.body.includes('desen'), false);
    assert.equal(options.body.includes('Eski bir plan'), false);
    const sentSummary = JSON.parse(request.messages[0].content.split('Gardırop: ')[1]);
    assert.deepEqual(sentSummary, [
      { id: '123', tur: 'Üst', renk: 'bordo', son_kullanim: 0 },
      { id: '456', tur: 'ayakkabı', renk: 'siyah', son_kullanim: 0 },
      { id: '789', tur: 'alt', renk: 'lacivert', son_kullanim: 'hic' },
    ]);
    return {
      ok: true,
      json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"mesaj":"Bu parçalar çok yakışır.","secilen_idler":["789","456"]}' } }] }),
    };
  });
  const result = await service.recommendOutfit('user-1', 'Daha spor olsun', wardrobe, [earlier]);
  assert.equal(result.mesaj, 'Bu parçalar çok yakışır.');
  assert.deepEqual(Array.from(result.secilen_idler), ['789', '456']);

  assert.equal(service.isReplacementRequest('Gömlek kirli'), true);
  assert.equal(service.isReplacementRequest('Bunu değiştirelim'), true);
  assert.equal(service.isReplacementRequest('Kahveye gidiyorum'), false);

  const exchangeWardrobe = [
    ...wardrobe,
    { id: '654', imageUri: 'file:///private/photo-654.jpg', tags: { tur: 'ayakkabı', renk: 'bordo', desen: 'düz' } },
    { id: '999', imageUri: 'file:///private/photo-999.jpg', tags: { tur: 'üst', renk: 'zümrüt', desen: 'düz' } },
  ];
  const shoeChange = { previousIds: ['123', '456'], replaceId: '456' };
  assert.deepEqual(Array.from(service.getReplacementCandidates(exchangeWardrobe, [earlier], shoeChange), (item) => item.id), ['654']);
  const exchange = loadWithFetch(async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.messages.length, 2);
    assert.equal(request.messages[1].role, 'user');
    assert.equal(request.messages[1].content.includes('Değişecek ID: 456'), true);
    assert.equal(request.messages[1].content.includes('Aynen korunacak ID\'ler: ["123"]'), true);
    assert.equal(request.messages[1].content.endsWith('sadece yeni eklediğin parçayla birlikte tam listeyi tekrar dön.'), true);
    assert.equal(options.body.includes('Eski bir plan'), false);
    assert.equal(options.body.includes('file:///'), false);
    const sent = JSON.parse(request.messages[0].content.split('Gardırop: ')[1]);
    assert.deepEqual(Array.from(sent, (item) => item.id), ['123', '456', '654']);
    return {
      ok: true,
      json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"mesaj":"Bordo ayakkabı çok iyi gider.","secilen_idler":["654","123"]}' } }] }),
    };
  });
  const exchanged = await exchange.recommendOutfit('user-1', 'Ayakkabı kirli', exchangeWardrobe, [earlier], undefined, shoeChange);
  assert.deepEqual(Array.from(exchanged.secilen_idler), ['123', '654']);

  const invalidExchange = loadWithFetch(async () => ({
    ok: true,
    json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"mesaj":"Başka bir kombin.","secilen_idler":["789","654"]}' } }] }),
  }));
  await assert.rejects(() => invalidExchange.recommendOutfit('user-1', 'Ayakkabı kirli', exchangeWardrobe, [earlier], undefined, shoeChange), /Invalid replacement response/);

  const noAlternative = loadWithFetch(async () => {
    throw new Error('Alternatif yoksa API çağrılmamalı');
  });
  await assert.rejects(() => noAlternative.recommendOutfit('user-1', 'Ayakkabı kirli', wardrobe, [earlier], undefined, shoeChange), /No replacement available/);

  const cooled = loadWithFetch(async () => {
    throw new Error('Cooldown sırasında API çağrılmamalı');
  });
  await assert.rejects(() => cooled.recommendOutfit('user-1', 'Yeni kombin', wardrobe.slice(0, 2), [earlier]), /No main piece available/);

  const invalid = loadWithFetch(async () => ({
    ok: true,
    json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"mesaj":"Öneri","secilen_idler":["123","456"]}' } }] }),
  }));
  await assert.rejects(() => invalid.recommendOutfit('user-1', 'Bir kombin öner', wardrobe, [earlier]), /Outfit violates cooldown/);
  console.log('Geçmiş, soğuma ve ekonomik parça değişimi testleri geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
