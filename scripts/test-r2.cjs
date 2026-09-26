const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/r2Storage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
let workerCall;
let copied;
let deleted;
const moduleUnderTest = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleUnderTest, exports: moduleUnderTest.exports,
  require: (name) => {
    if (name === 'expo-file-system/legacy') return {
      cacheDirectory: 'file:///cache/',
      copyAsync: async (args) => { copied = args; },
      getInfoAsync: async () => ({ exists: true, size: 5 }),
      deleteAsync: async (uri) => { deleted = uri; },
    };
    if (name === './uploadStatus') return { withUploadStatus: (_label, task) => task() };
    if (name === './workerApi') return {
      workerPost: async () => ({ ok: true }),
      workerUpload: async (...args) => { workerCall = args; return { publicUrl: 'https://worker.example/media/gallery/user-1/photo.png?token=random', key: 'gallery/user-1/photo.png' }; },
    };
    throw new Error(`Unexpected import: ${name}`);
  },
});

async function main() {
  const service = moduleUnderTest.exports;
  assert.equal(service.imageMimeType('file:///photo.PNG', ''), 'image/png');
  const uploaded = await service.uploadImageToR2('user-1', 'gallery', 'file:///photo.PNG', { fileName: 'look 01.png', mimeType: 'image/png', fileSize: 5 });
  assert.equal(workerCall[1], '/upload-image');
  assert.equal(workerCall[2].uri, copied.to);
  assert.equal(copied.from, 'file:///photo.PNG');
  assert.equal(workerCall[2].type, 'image/png');
  assert.match(workerCall[2].uri, /^file:\/\/\/cache\/negiysem-upload-.+\.png$/);
  assert.equal(deleted, workerCall[2].uri);
  assert.equal(workerCall[3], 'gallery');
  assert.deepEqual({ ...uploaded }, { key: 'gallery/user-1/photo.png', url: 'https://worker.example/media/gallery/user-1/photo.png?token=random' });
  await assert.rejects(() => service.uploadImageToR2('user-1', 'gallery', 'file:///large.jpg', { fileSize: 21 * 1024 * 1024 }), /20 MB/);
  console.log('Kimlik doğrulamalı Worker yükleme, MIME ve özel R2 medya adresi akışı geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
