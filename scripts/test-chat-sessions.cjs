const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/data/chatSessions.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const deleted = [];
let queriedUser;
let owner = 'user-1';
const rows = Array.from({ length: 451 }, (_, index) => ({ ref: { id: `chat-${index}` } }));
const firestore = {
  collection: (_db, name) => name,
  doc: (_db, name, id) => ({ name, id }),
  getDoc: async () => ({ exists: () => true, data: () => ({ userId: owner }) }),
  getDocs: async () => ({ docs: rows }),
  query: (name, filter) => { assert.equal(name, 'chat_sessions'); queriedUser = filter; return {}; },
  where: (field, operator, value) => ({ field, operator, value }),
  writeBatch: () => {
    const pending = [];
    return { delete: (ref) => pending.push(ref.id), commit: async () => { assert.ok(pending.length <= 450); deleted.push(...pending); } };
  },
};
const moduleUnderTest = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleUnderTest, exports: moduleUnderTest.exports,
  require: (name) => {
    if (name === 'firebase/firestore') return firestore;
    if (name === '../config/firebase') return { firestore: {} };
    throw new Error(`Unexpected import: ${name}`);
  },
});

async function main() {
  const service = moduleUnderTest.exports;
  await service.clearChatSessions('user-1');
  assert.deepEqual(queriedUser, { field: 'userId', operator: '==', value: 'user-1' });
  assert.equal(deleted.length, 451);
  owner = 'another-user';
  await assert.rejects(() => service.deleteChatSession('user-1', 'chat-0'), /yetkin yok/);
  assert.equal(deleted.length, 451);
  owner = 'user-1';
  await service.deleteChatSession('user-1', 'chat-0');
  assert.equal(deleted.at(-1), 'chat-0');
  console.log('Kullanıcıya özel sohbet temizleme, 450 kayıtlık batch ve tekli sahiplik kontrolü geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
