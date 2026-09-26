const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/data/social.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function main() {
  const calls = [];
  const moduleUnderTest = { exports: {} };
  vm.runInNewContext(compiled, {
    module: moduleUnderTest,
    exports: moduleUnderTest.exports,
    require: (name) => {
      if (name === 'firebase/firestore') return {
        doc: (_db, collection, id) => ({ collection, id }),
        getDoc: async (ref) => {
          assert.equal(ref.collection, 'users');
          assert.equal(ref.id, 'user-1');
          return { exists: () => true, data: () => ({ avatarKey: 'avatars/user-1/old.jpg' }) };
        },
        updateDoc: async (ref, data) => { calls.push(['firestore', ref, data]); },
      };
      if (name === '../config/firebase') return { firestore: {} };
      if (name === '../services/r2Storage') return {
        uploadImageToR2: async (...args) => { calls.push(['upload', ...args]); return { url: 'https://worker.example/media/new', key: 'avatars/user-1/new.jpg' }; },
        deleteR2Object: async (key) => { calls.push(['delete', key]); },
      };
      if (name === '../utils/sanitize') return { sanitizeUserText: (value) => value };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const metadata = { fileName: 'avatar.jpg', mimeType: 'image/jpeg', fileSize: 5 };
  const result = await moduleUnderTest.exports.updateAvatar('user-1', 'file:///avatar.jpg', metadata);
  assert.equal(result, 'https://worker.example/media/new');
  assert.equal(calls[0][0], 'upload');
  assert.equal(calls[0][1], 'user-1');
  assert.equal(calls[0][2], 'avatars');
  assert.deepEqual({ ...calls[0][4] }, metadata);
  assert.deepEqual({ ...calls[1][2] }, { avatarUri: result, avatarKey: 'avatars/user-1/new.jpg' });
  assert.equal(calls[2][1], 'avatars/user-1/old.jpg');
  console.log('Profil fotoğrafı R2 URL kaydı ve Firestore güncelleme sırası geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
