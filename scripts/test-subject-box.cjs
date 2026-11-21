// Unit tests for the garment finder used by the Add Clothing auto-crop (pure logic, no device needed).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const source = ts.transpileModule(fs.readFileSync('src/utils/subjectBox.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module_ = { exports: {} };
vm.runInNewContext(source, { module: module_, exports: module_.exports });
const { findSubjectBox: rawFind, suggestCrop: rawSuggest, boxToCropRect: rawRect } = module_.exports;
// Values created inside the VM have another prototype; normalise them so deepEqual compares plain data.
const plain = (value) => (value === null ? null : JSON.parse(JSON.stringify(value)));
const findSubjectBox = (...args) => plain(rawFind(...args));
const suggestCrop = (...args) => plain(rawSuggest(...args));
const boxToCropRect = (...args) => plain(rawRect(...args));

function image(width, height, background, paint) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = paint(x, y) ?? background;
    const i = (y * width + x) * 4;
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 255;
  }
  return data;
}
const white = [245, 245, 245];
const rect = (x0, y0, x1, y1, color) => (x, y) => (x >= x0 && x < x1 && y >= y0 && y < y1 ? color : null);

// 1. A small, off-center garment on a plain background is found exactly.
{
  const w = 96, h = 128;
  const data = image(w, h, white, rect(10, 20, 40, 70, [20, 30, 120]));
  const box = findSubjectBox(data, w, h);
  assert.deepEqual(box, { left: 10, top: 20, width: 30, height: 50 });
  const crop = suggestCrop(box, w, h);
  assert.ok(crop, 'crop suggested');
  // The garment is fully inside the suggested frame, with padding, and the frame stays inside the image.
  assert.ok(crop.left <= box.left && crop.top <= box.top && crop.left + crop.width >= box.left + box.width && crop.top + crop.height >= box.top + box.height);
  assert.ok(crop.left >= 0 && crop.top >= 0 && crop.left + crop.width <= w && crop.top + crop.height <= h);
  assert.ok(crop.width * crop.height < w * h * 0.5, 'the frame is much tighter than the photo');
  const aspect = crop.width / crop.height;
  assert.ok(aspect >= 0.72 - 0.02 && aspect <= 1.1 + 0.02, `aspect ${aspect} stays portrait-ish`);
}

// 2. A dark background works too (border color is estimated, not assumed white).
{
  const w = 96, h = 96;
  const data = image(w, h, [15, 15, 15], rect(30, 30, 70, 80, [200, 190, 180]));
  assert.deepEqual(findSubjectBox(data, w, h), { left: 30, top: 30, width: 40, height: 50 });
}

// 3. Single-pixel noise and dust do not stretch the box.
{
  const w = 96, h = 96;
  const speck = (x, y) => (x === 3 && y === 90 ? [0, 0, 0] : rect(30, 30, 60, 60, [90, 20, 20])(x, y));
  assert.deepEqual(findSubjectBox(image(w, h, white, speck), w, h), { left: 30, top: 30, width: 30, height: 30 });
}

// 4. A busy / gradient background is rejected: the photo is left untouched.
{
  const w = 96, h = 96;
  const busy = image(w, h, white, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(findSubjectBox(busy, w, h), null);
}

// 5. A blank photo has no subject.
assert.equal(findSubjectBox(image(64, 64, white, () => null), 64, 64), null);

// 6. Already-tight photos are not re-cropped; tiny blobs are ignored.
{
  assert.equal(suggestCrop({ left: 1, top: 1, width: 94, height: 94 }, 96, 96), null);
  assert.equal(suggestCrop({ left: 40, top: 40, width: 4, height: 4 }, 96, 96), null);
}

// 7. A garment touching the image edge keeps the frame inside the image (shifted, never negative).
{
  const crop = suggestCrop({ left: 0, top: 0, width: 30, height: 40 }, 96, 128);
  assert.ok(crop.left === 0 && crop.top === 0);
  assert.ok(crop.left + crop.width <= 96 && crop.top + crop.height <= 128);
}

// 8. Very wide garments (e.g. a shoe) are given a frame no flatter than the max aspect ratio.
{
  const crop = suggestCrop({ left: 10, top: 40, width: 70, height: 20 }, 96, 128);
  assert.ok(crop.width / crop.height <= 1.1 + 0.02);
}
// 9. Full pure pipeline on a real JPEG: encode -> base64 -> (RN-safe) decode -> garment box.
{
  const jpeg = require('jpeg-js');
  const load = (file) => { const m = { exports: {} }; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: m, exports: m.exports }); return m.exports; };
  const { base64ToBytes } = load('src/utils/base64.ts');
  const w = 96, h = 120;
  const raw = image(w, h, white, rect(20, 25, 70, 100, [30, 60, 140]));
  const encoded = jpeg.encode({ data: Buffer.from(raw), width: w, height: h }, 90).data;
  const bytes = base64ToBytes(Buffer.from(encoded).toString('base64'));
  assert.equal(bytes.length, encoded.length);
  assert.ok(Buffer.from(bytes).equals(Buffer.from(encoded)), 'base64 round trip is lossless');
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  assert.ok(decoded.data instanceof Uint8Array && !Buffer.isBuffer(decoded.data), 'decoder avoids Buffer');
  const box = findSubjectBox(decoded.data, decoded.width, decoded.height);
  assert.ok(box && Math.abs(box.left - 20) <= 2 && Math.abs(box.top - 25) <= 2 && Math.abs(box.width - 50) <= 4 && Math.abs(box.height - 75) <= 4, `box ${JSON.stringify(box)}`);
}

// 10. Gradient background (~80 grey levels left to right) with a garment: found, gradient not mistaken for subject.
{
  const w = 96, h = 128;
  const grad = (x) => 150 + Math.round((x / (w - 1)) * 80);
  const data = image(w, h, white, (x, y) => (x >= 30 && x < 66 && y >= 30 && y < 100 ? [40, 50, 110] : [grad(x), grad(x), grad(x)]));
  const box = findSubjectBox(data, w, h);
  assert.ok(box && Math.abs(box.left - 30) <= 2 && Math.abs(box.top - 30) <= 2 && Math.abs(box.width - 36) <= 3 && Math.abs(box.height - 70) <= 3, `gradient box ${JSON.stringify(box)}`);
}

// 11. A soft shadow beside the garment is not part of the box.
{
  const w = 96, h = 128;
  const data = image(w, h, white, (x, y) => {
    if (x >= 20 && x < 50 && y >= 25 && y < 90) return [30, 70, 40];
    if (x >= 50 && x < 66 && y >= 40 && y < 100) { const k = 0.9 - ((x - 50) / 16) * 0.05 * 0 - 0.12 * (1 - (x - 50) / 16); return [Math.round(245 * k), Math.round(245 * k), Math.round(245 * k)]; }
    return null;
  });
  const box = findSubjectBox(data, w, h);
  assert.ok(box && box.left === 20 && box.width === 30 && box.top === 25 && box.height === 65, `shadow box ${JSON.stringify(box)}`);
}

// 12. Garments filling most of the frame (trousers 40% x 85%, dress 50% x 82%) now get a crop.
{
  const w = 96, h = 128;
  for (const [gw, gh] of [[0.4, 0.85], [0.5, 0.82]]) {
    const bw = Math.round(w * gw), bh = Math.round(h * gh), x0 = Math.round((w - bw) / 2), y0 = Math.round((h - bh) / 2);
    const subject = findSubjectBox(image(w, h, white, rect(x0, y0, x0 + bw, y0 + bh, [25, 25, 60])), w, h);
    assert.ok(subject, 'subject found');
    const crop = suggestCrop(subject, w, h);
    assert.ok(crop, `crop for ${gw}x${gh}`);
    assert.ok(crop.left <= subject.left && crop.left + crop.width >= subject.left + subject.width && crop.top >= 0 && crop.top + crop.height <= h);
  }
  // Already-full photos still skip.
  assert.equal(suggestCrop({ left: 2, top: 2, width: 92, height: 124 }, 96, 128), null);
}

// 13. White shirt on a light-grey background.
{
  const w = 96, h = 128;
  const box = findSubjectBox(image(w, h, [205, 205, 205], rect(25, 30, 70, 100, [252, 252, 252])), w, h);
  assert.deepEqual(box, { left: 25, top: 30, width: 45, height: 70 });
}

// 14. boxToCropRect: padding, clamping, invalid boxes and the skip rule.
{
  const r = boxToCropRect({ x: 0.3, y: 0.2, width: 0.4, height: 0.5 }, 1000, 2000);
  assert.equal(r.reason, 'ok');
  assert.ok(r.rect.originX < 300 && r.rect.originY < 400 && r.rect.originX + r.rect.width > 700 && r.rect.originY + r.rect.height > 1400);
  const edge = boxToCropRect({ x: 0, y: 0, width: 0.5, height: 0.5 }, 1000, 1000);
  assert.ok(edge.rect.originX === 0 && edge.rect.originY === 0 && edge.rect.width <= 1000);
  assert.equal(boxToCropRect({ x: 0, y: 0, width: 1, height: 1 }, 1000, 1000).reason, 'skip_rule');
  assert.equal(boxToCropRect({ x: 0.9, y: 0.2, width: 0.3, height: 0.5 }, 1000, 1000).reason, 'invalid_box');
  assert.equal(boxToCropRect({ x: 0.1, y: 0.1, width: 0.01, height: 0.5 }, 1000, 1000).reason, 'invalid_box');
  assert.equal(boxToCropRect(null, 1000, 1000).reason, 'invalid_box');
  assert.equal(boxToCropRect({ x: NaN, y: 0, width: 0.5, height: 0.5 }, 1000, 1000).reason, 'invalid_box');
}
console.log('Subject box: detection (light/dark backgrounds), noise, busy-background rejection, padding, aspect clamp and edge handling passed.');
