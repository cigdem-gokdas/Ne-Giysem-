/**
 * Pure helpers that locate a garment photographed on a (roughly) uniform background and suggest a tight,
 * balanced crop. No React Native imports so it can be unit-tested in Node.
 */
export type Box = { left: number; top: number; width: number; height: number };

type CropOptions = {
  /** Extra space around the garment as a fraction of its own size. */
  padding?: number;
  /** Keeps the result a sensible portrait-ish frame: width / height is clamped to [minAspect, maxAspect]. */
  minAspect?: number;
  maxAspect?: number;
  /** Skip cropping when the suggested frame already covers this share of the image. */
  skipAbove?: number;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Bounding box of everything that differs from the local background. The background is modelled from the four
 * edge strips (nearest strip median, plus a row/column interpolation so soft gradients work). Null when the
 * background is too busy or nothing stands out.
 */
export function findSubjectBox(rgba: Uint8Array, width: number, height: number): Box | null {
  if (width < 8 || height < 8 || rgba.length < width * height * 4) return null;
  const ring = Math.max(1, Math.round(Math.min(width, height) * 0.03));
  const at = (x: number, y: number) => (y * width + x) * 4;

  // Per-channel medians of each edge strip.
  const stripMedian = (xs: number, xe: number, ys: number, ye: number) => {
    const out: number[][] = [[], [], []];
    for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) { const i = at(x, y); out[0].push(rgba[i]); out[1].push(rgba[i + 1]); out[2].push(rgba[i + 2]); }
    return out.map(median);
  };
  const strips = [
    { med: stripMedian(0, width, 0, ring) },
    { med: stripMedian(0, width, height - ring, height) },
    { med: stripMedian(0, ring, 0, height) },
    { med: stripMedian(width - ring, width, 0, height) },
  ];
  // Row ends (left/right) and column ends (top/bottom) for gradient interpolation.
  const rowEnds = (y: number) => {
    const l: number[][] = [[], [], []], r: number[][] = [[], [], []];
    for (let x = 0; x < ring; x++) { const a = at(x, y), b = at(width - 1 - x, y); for (let c = 0; c < 3; c++) { l[c].push(rgba[a + c]); r[c].push(rgba[b + c]); } }
    return { l: l.map(mean), r: r.map(mean) };
  };
  const colEnds = (x: number) => {
    const t: number[][] = [[], [], []], b: number[][] = [[], [], []];
    for (let y = 0; y < ring; y++) { const p = at(x, y), q = at(x, height - 1 - y); for (let c = 0; c < 3; c++) { t[c].push(rgba[p + c]); b[c].push(rgba[q + c]); } }
    return { t: t.map(mean), b: b.map(mean) };
  };
  const rows = Array.from({ length: height }, (_, y) => rowEnds(y));
  const cols = Array.from({ length: width }, (_, x) => colEnds(x));

  /** Distance to the closest background estimate, and that estimate (for the shadow test). */
  const best = { d: 0, r: 0, g: 0, b: 0 };
  const evaluate = (x: number, y: number, interpolatedOnly = false) => {
    const i = at(x, y);
    const pr = rgba[i], pg = rgba[i + 1], pb = rgba[i + 2];
    best.d = Infinity;
    const consider = (r: number, g: number, b: number) => {
      const d = Math.hypot(pr - r, pg - g, pb - b);
      if (d < best.d) { best.d = d; best.r = r; best.g = g; best.b = b; }
    };
    const tx = x / (width - 1), ty = y / (height - 1);
    const row = rows[y], col = cols[x];
    consider(row.l[0] + (row.r[0] - row.l[0]) * tx, row.l[1] + (row.r[1] - row.l[1]) * tx, row.l[2] + (row.r[2] - row.l[2]) * tx);
    consider(col.t[0] + (col.b[0] - col.t[0]) * ty, col.t[1] + (col.b[1] - col.t[1]) * ty, col.t[2] + (col.b[2] - col.t[2]) * ty);
    if (!interpolatedOnly) for (const strip of strips) consider(strip.med[0], strip.med[1], strip.med[2]);
    return { pr, pg, pb };
  };

  let spreadSum = 0, spreadCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < ring || y < ring || x >= width - ring || y >= height - ring) { evaluate(x, y, true); spreadSum += best.d; spreadCount++; }
    }
  }
  const spread = spreadSum / spreadCount;
  // A busy background (high spread; measured against the smooth row/column model only at the edges) cannot be trimmed reliably: leave the photo alone.
  if (spread > 45) return null;
  const threshold = Math.max(34, spread * 3 + 18);

  const rowCounts = new Array<number>(height).fill(0);
  const colCounts = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { pr, pg, pb } = evaluate(x, y);
      if (best.d <= threshold) continue;
      // Shadow: a neutral-ish darkening of the background (same hue, mildly lower luminance), not a garment.
      const bgLuma = luma(best.r, best.g, best.b);
      const k = bgLuma > 1 ? luma(pr, pg, pb) / bgLuma : 1;
      if (k < 1 && k > 0.55 && Math.hypot(pr - best.r * k, pg - best.g * k, pb - best.b * k) < 16 && Math.max(pr, pg, pb) - Math.min(pr, pg, pb) < 45) continue;
      rowCounts[y]++; colCounts[x]++;
    }
  }
  const minRow = Math.max(2, Math.round(width * 0.015));
  const minCol = Math.max(2, Math.round(height * 0.015));
  const top = rowCounts.findIndex((count) => count >= minRow);
  const left = colCounts.findIndex((count) => count >= minCol);
  let bottom = -1; for (let y = height - 1; y >= 0; y--) if (rowCounts[y] >= minRow) { bottom = y; break; }
  let right = -1; for (let x = width - 1; x >= 0; x--) if (colCounts[x] >= minCol) { right = x; break; }
  if (top < 0 || left < 0 || bottom < top || right < left) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Expands the garment box with balanced padding, widens to a portrait-ish aspect when that fits, and keeps it inside the image. */
export function suggestCrop(subject: Box, imageWidth: number, imageHeight: number, options: CropOptions = {}): Box | null {
  const { padding = 0.1, minAspect = 0.72, maxAspect = 1.1, skipAbove = 0.9 } = options;
  // Too small: probably noise or a stain, not a garment. Too large: the photo is already tight.
  const share = (subject.width * subject.height) / (imageWidth * imageHeight);
  if (share < 0.04) return null;

  let width = Math.min(subject.width * (1 + padding * 2), imageWidth);
  let height = Math.min(subject.height * (1 + padding * 2), imageHeight);
  // Decide "already tight" on the padded box, before any aspect widening.
  if ((width * height) / (imageWidth * imageHeight) > skipAbove) return null;

  const aspect = width / height;
  let adjustedWidth = width, adjustedHeight = height;
  if (aspect > maxAspect) adjustedHeight = width / maxAspect;
  else if (aspect < minAspect) adjustedWidth = height * minAspect;
  // Only adopt the aspect adjustment when it fits in the image; otherwise keep the padded box.
  if (adjustedWidth <= imageWidth + 0.5 && adjustedHeight <= imageHeight + 0.5) { width = Math.min(adjustedWidth, imageWidth); height = Math.min(adjustedHeight, imageHeight); }

  const centerX = subject.left + subject.width / 2;
  const centerY = subject.top + subject.height / 2;
  const left = Math.min(Math.max(0, centerX - width / 2), imageWidth - width);
  const top = Math.min(Math.max(0, centerY - height / 2), imageHeight - height);
  return { left: Math.round(left), top: Math.round(top), width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

export type NormalizedBox = { x: number; y: number; width: number; height: number };
export type CropRect = { originX: number; originY: number; width: number; height: number };
export type BoxCropResult = { rect: CropRect | null; reason: 'ok' | 'invalid_box' | 'skip_rule' };

/** Converts a normalized (0-1, top-left origin) AI box to a padded pixel crop rect; no aspect constraint. */
export function boxToCropRect(box: NormalizedBox | null | undefined, imageWidth: number, imageHeight: number, options: { padding?: number; skipAbove?: number } = {}): BoxCropResult {
  const { padding = 0.06, skipAbove = 0.95 } = options;
  if (!box || !(imageWidth >= 1) || !(imageHeight >= 1)) return { rect: null, reason: 'invalid_box' };
  const { x, y, width, height } = box;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return { rect: null, reason: 'invalid_box' };
  if (x < 0 || y < 0 || width < 0.05 || height < 0.05 || x + width > 1.0001 || y + height > 1.0001) return { rect: null, reason: 'invalid_box' };
  const left = Math.max(0, x - width * padding);
  const top = Math.max(0, y - height * padding);
  const right = Math.min(1, x + width * (1 + padding));
  const bottom = Math.min(1, y + height * (1 + padding));
  const originX = Math.min(imageWidth - 1, Math.max(0, Math.floor(left * imageWidth)));
  const originY = Math.min(imageHeight - 1, Math.max(0, Math.floor(top * imageHeight)));
  const w = Math.max(1, Math.min(imageWidth - originX, Math.ceil(right * imageWidth) - originX));
  const h = Math.max(1, Math.min(imageHeight - originY, Math.ceil(bottom * imageHeight) - originY));
  if ((w * h) / (imageWidth * imageHeight) > skipAbove) return { rect: null, reason: 'skip_rule' };
  return { rect: { originX, originY, width: w, height: h }, reason: 'ok' };
}
