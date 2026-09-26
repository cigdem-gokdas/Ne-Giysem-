const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../api-worker/src/outfitRules.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
vm.runInNewContext(compiled, { module: moduleUnderTest, exports: moduleUnderTest.exports });
const { completeOutfit } = moduleUnderTest.exports;

function piece(id, tur, kesim = 'normal', alt_tur = 'diğer', kemer_uygun = false) {
  return { id, tur, renk: 'siyah', kesim, alt_tur, kemer_uygun, son_kullanim: 'hic', kullanim_sayisi: 0 };
}

const wardrobe = [
  piece('wide-top', 'üst', 'bol', 'tişört'), piece('fit-top', 'üst', 'dar', 'gömlek'),
  piece('wide-bottom', 'alt', 'bol', 'pantolon', true), piece('wide-jacket', 'dış giyim', 'bol', 'ceket'),
  piece('shoes', 'ayakkabı', 'normal', 'ayakkabı'), piece('bag', 'aksesuar', 'normal', 'çanta'),
  piece('belt', 'aksesuar', 'normal', 'kemer'),
];
const result = completeOutfit({ mesaj: 'Koyu Kış görünümü.', secilen_idler: ['wide-top', 'wide-bottom'] }, wardrobe);
assert.deepEqual(Array.from(result.secilen_idler), ['wide-bottom', 'fit-top', 'wide-jacket', 'shoes', 'bag', 'belt']);
assert.equal(result.mesaj.includes('Gardırobunda olmayan'), false);

const minimalWardrobe = [wardrobe[0], wardrobe[2]];
const missing = completeOutfit({ mesaj: 'Sade bir görünüm.', secilen_idler: ['wide-top', 'wide-bottom'] }, minimalWardrobe);
assert.equal(missing.secilen_idler.includes('wide-top'), false);
assert.match(missing.mesaj, /vücuda oturan|fitted/i);
assert.match(missing.mesaj, /ceket/);
assert.match(missing.mesaj, /Mary Jane/);
assert.match(missing.mesaj, /çanta/);
assert.match(missing.mesaj, /kemer/);
assert.equal(missing.secilen_idler.every((id) => minimalWardrobe.some((item) => item.id === id)), true);

const replacement = completeOutfit({ mesaj: 'Ayakkabı değişti.', secilen_idler: ['wide-bottom', 'wide-jacket'] }, wardrobe, true);
assert.deepEqual(Array.from(replacement.secilen_idler), ['wide-bottom', 'wide-jacket']);
assert.match(replacement.mesaj, /çanta/);
console.log('Silüet dengesi, zorunlu parçalar, kemer ve gerçek ID koruması geçti.');
