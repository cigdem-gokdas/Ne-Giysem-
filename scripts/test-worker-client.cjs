const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/workerApi.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function load(fetchMock, tokenCalls, uploadMock = async () => { throw new Error('Unexpected upload'); }) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, fetch: fetchMock, URL, AbortController, setTimeout, clearTimeout,
    require: (name) => {
      if (name === '../config/firebase') return { firebaseAuth: { currentUser: { uid: 'user-1', getIdToken: async (refresh) => { tokenCalls.push(refresh); return refresh ? 'fresh-token' : 'token'; } } } };
      if (name === '../config/env') return { WORKER_URL: 'https://worker.example/' };
      if (name === 'expo-file-system/legacy') return { createUploadTask: (...args) => ({ uploadAsync: () => uploadMock(...args), cancelAsync: async () => {} }), FileSystemUploadType: { MULTIPART: 1 } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return module.exports;
}

async function main() {
  const tokenCalls = [];
  let calls = 0;
  const service = load(async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://worker.example/generate-outfit');
    assert.equal(options.method, 'POST');
    if (calls === 1) return { status: 401, ok: false, json: async () => ({ error: 'expired' }) };
    assert.equal(options.headers.Authorization, 'Bearer fresh-token');
    return { status: 200, ok: true, json: async () => ({ recommendation: { mesaj: 'ok', secilen_idler: ['1', '2'] } }) };
  }, tokenCalls);
  const result = await service.workerPost('user-1', '/generate-outfit', { wardrobe: [] });
  assert.equal(result.recommendation.mesaj, 'ok');
  assert.deepEqual(tokenCalls, [false, true]);

  const limited = load(async () => ({ status: 429, ok: false, json: async () => ({ error: 'Bekle', code: 'cooldown', waitSeconds: 12 }) }), []);
  await assert.rejects(() => limited.workerPost('user-1', '/generate-outfit', {}), (error) => error.name === 'RateLimitError' && error.reason === 'cooldown' && error.waitSeconds === 12);

  const uploadFile = { uri: 'file:///photo.jpg', type: 'image/jpeg' };
  const upload = load(async () => { throw new Error('File upload must not use fetch'); }, [], async (url, uri, options) => {
    assert.equal(url, 'https://worker.example/upload-image');
    assert.equal(uri, uploadFile.uri);
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.equal(options.uploadType, 1);
    assert.equal(options.fieldName, 'file');
    assert.equal(options.mimeType, 'image/jpeg');
    assert.equal(options.parameters.folder, 'wardrobe');
    return { status: 200, body: JSON.stringify({ publicUrl: 'https://worker.example/media/photo', key: 'wardrobe/user-1/photo.jpg' }) };
  });
  const uploaded = await upload.workerUpload('user-1', '/upload-image', uploadFile, 'wardrobe');
  assert.equal(uploaded.key, 'wardrobe/user-1/photo.jpg');
  let uploadAttempts = 0;
  const retryUpload = load(async () => { throw new Error('File upload must not use fetch'); }, [], async (_url, _uri, options) => {
    uploadAttempts += 1;
    if (uploadAttempts === 1) return { status: 401, body: JSON.stringify({ error: 'expired' }) };
    assert.equal(options.headers.Authorization, 'Bearer fresh-token');
    return { status: 200, body: JSON.stringify({ publicUrl: 'https://worker.example/media/photo', key: 'wardrobe/user-1/photo.jpg' }) };
  });
  await retryUpload.workerUpload('user-1', '/upload-image', uploadFile, 'wardrobe');
  assert.equal(uploadAttempts, 2);
  const tooLarge = load(async () => { throw new Error('File upload must not use fetch'); }, [], async () => ({ status: 413, body: JSON.stringify({ error: 'Fotoğraf 20 MB sınırını aşıyor.' }) }));
  await assert.rejects(() => tooLarge.workerUpload('user-1', '/upload-image', uploadFile, 'wardrobe'), /20 MB/);
  // B10: upload maps 429 / pro_required like workerPost; non-JSON failures report the HTTP status in Turkish.
  const uploadLimited = load(async () => { throw new Error('no fetch'); }, [], async () => ({ status: 429, body: JSON.stringify({ error: 'Günlük sınır', code: 'storage' }) }));
  await assert.rejects(() => uploadLimited.workerUpload('user-1', '/upload-image', uploadFile, 'wardrobe'), (error) => error.name === 'RateLimitError' && error.reason === 'storage');
  const uploadThrottled = load(async () => { throw new Error('no fetch'); }, [], async () => ({ status: 429, body: JSON.stringify({ error: 'Yavaş', code: 'cooldown', waitSeconds: 5 }) }));
  await assert.rejects(() => uploadThrottled.workerUpload('user-1', '/upload-image', uploadFile, 'wardrobe'), (error) => error.name === 'RateLimitError' && error.waitSeconds === 5);
  const uploadPro = load(async () => { throw new Error('no fetch'); }, [], async () => ({ status: 403, body: JSON.stringify({ error: 'Pro gerekli', code: 'pro_required' }) }));
  await assert.rejects(() => uploadPro.workerUpload('user-1', '/upload-image', uploadFile, 'wardrobe'), (error) => error.name === 'ProRequiredError');
  const uploadHtml = load(async () => { throw new Error('no fetch'); }, [], async () => ({ status: 502, body: '<html>bad gateway</html>' }));
  await assert.rejects(() => uploadHtml.workerUpload('user-1', '/upload-image', uploadFile, 'wardrobe'), /HTTP 502/);
  const html = load(async () => ({ status: 503, ok: false, json: async () => { throw new SyntaxError('Unexpected token <'); } }), []);
  await assert.rejects(() => html.workerPost('user-1', '/generate-outfit', {}), (error) => /HTTP 503/.test(error.message) && !/Worker/.test(error.message));
  const noMessage = load(async () => ({ status: 500, ok: false, json: async () => ({}) }), []);
  await assert.rejects(() => noMessage.workerPost('user-1', '/generate-outfit', {}), (error) => /HTTP 500/.test(error.message) && !/Worker/.test(error.message));
  // App Check: header attached only when a provider returns a token.
  const seen = [];
  const withCheck = load(async (_url, options) => { seen.push(options.headers['X-Firebase-AppCheck']); return { status: 200, ok: true, json: async () => ({ ok: true }) }; }, []);
  await withCheck.workerPost('user-1', '/subscription-status', {});
  withCheck.setAppCheckTokenProvider(async () => 'app-check-token');
  await withCheck.workerPost('user-1', '/subscription-status', {});
  withCheck.setAppCheckTokenProvider(async () => { throw new Error('boom'); });
  await withCheck.workerPost('user-1', '/subscription-status', {});
  withCheck.setAppCheckTokenProvider(async () => null);
  await withCheck.workerPost('user-1', '/subscription-status', {});
  assert.deepEqual(seen, [undefined, 'app-check-token', undefined, undefined]);
  // S11: sanitize loops until stable, strips invisible chars, keeps ordinary words.
  const sanitizeModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/sanitize.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: sanitizeModule, exports: sanitizeModule.exports });
  const { sanitizeUserText, sanitizeUsername } = sanitizeModule.exports;
  assert.equal(sanitizeUserText('javajavascript:script:alert(1)'), 'alert(1)');
  assert.equal(sanitizeUserText('<scr<script>ipt>x').includes('<'), false);
  assert.equal(sanitizeUserText('java\u200Bscript:x\u202E y'), 'x y');
  assert.equal(sanitizeUserText('one = 1, only= two, Mon=ton'), 'one = 1, only= two, Mon=ton');
  assert.equal(sanitizeUserText('a onclick=alert(1) b'), 'a alert(1) b');
  assert.equal(sanitizeUsername('  <b>Ayşe</b>\u200B  '), 'Ayşe');
  assert.equal(sanitizeUsername('x'.repeat(50)).length, 32);
  console.log('Worker Firebase token, Expo native multipart yükleme, 401 yenileme ve kota hata sözleşmesi geçti.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
