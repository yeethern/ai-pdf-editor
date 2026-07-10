import fs from 'fs';
import path from 'path';
import { createCanvas, registerFont, Image } from 'canvas';

const _pageImgCache = new WeakMap<Buffer, any>();

function decodePageImage(buf: Buffer): any {
  if (_pageImgCache.has(buf)) return _pageImgCache.get(buf);
  try {
    const img = new Image();
    img.src = buf;
    if (img.width && img.height) { _pageImgCache.set(buf, img); return img; }
  } catch {}
  return null;
}

function countDarkDensity(ctx: any, w: number, h: number): number {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    let dark = 0, total = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum < 128) dark++;
      total++;
    }
    return dark / total;
  } catch { return 0; }
}

function measureWordDarkDensity(pageImage: Buffer, pixelBbox: [number, number, number, number]): number {
  const img = decodePageImage(pageImage);
  if (!img) return 0;
  let [bx, by, bw, bh] = pixelBbox;
  bx = Math.max(0, Math.floor(bx) - 1);
  by = Math.max(0, Math.floor(by) - 1);
  bw = Math.min(Math.ceil(bw) + 2, img.width - bx);
  bh = Math.min(Math.ceil(bh) + 2, img.height - by);
  if (bw < 2 || bh < 2) return 0;
  try {
    const c = createCanvas(bw, bh);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, bx, by, bw, bh, 0, 0, bw, bh);
    return countDarkDensity(ctx, bw, bh);
  } catch { return 0; }
}

const MACOS_SYSTEM_FONTS = [
  'Helvetica', 'Helvetica Neue', 'Times New Roman', 'Courier New', 'Arial',
  'Palatino', 'Optima', 'Georgia', 'Verdana', 'Trebuchet MS', 'Gill Sans',
  'Futura', 'Avenir', 'Menlo', 'Monaco', 'Lucida Grande', 'Geneva',
];

const FONTS_DIR = path.join(__dirname, '..', '..', '..', '..', 'backend', 'fonts');

let registered = false;

export function registerAll(): void {
  if (registered) return;
  if (!fs.existsSync(FONTS_DIR)) {
    console.log('Font engine: no fonts directory found, using macOS system fonts only');
    registered = true;
    return;
  }
  const files = fs.readdirSync(FONTS_DIR).filter(f => f.endsWith('.ttf'));
  let ok = 0, fail = 0;
  for (const file of files) {
    const nameNoExt = file.replace(/\.ttf$/i, '');
    const hasVar = file.includes('[');
    const family = hasVar ? nameNoExt.replace(/\[.*\]$/, '') : nameNoExt.split('-')[0];
    const variant = hasVar ? '' : nameNoExt.slice(family.length + 1);
    const filePath = path.join(FONTS_DIR, file);
    try {
      if (!variant || variant === 'Regular') {
        registerFont(filePath, { family, weight: 'normal', style: 'normal' });
      } else {
        const w = variant.includes('Bold') ? 'bold' : 'normal';
        const s = variant.includes('Italic') ? 'italic' : 'normal';
        registerFont(filePath, { family, weight: w, style: s });
      }
      ok++;
    } catch { fail++; }
  }
  console.log(`Font engine: ${ok} registered, ${fail} failed (${files.length} files in ${FONTS_DIR})`);
  registered = true;
}

let _candidates: string[] | null = null;

function listCandidates(): string[] {
  if (_candidates) return _candidates;
  registerAll();
  const googleFamilies: string[] = [];
  if (fs.existsSync(FONTS_DIR)) {
    const seen = new Set<string>();
    const files = fs.readdirSync(FONTS_DIR).filter(f => f.endsWith('.ttf'));
    for (const file of files) {
      const name = file.replace(/\.ttf$/i, '');
      const family = name.includes('[') ? name.replace(/\[.*\]$/, '') : name.split('-')[0];
      if (seen.has(family)) continue;
      seen.add(family);
      googleFamilies.push(family);
    }
  }
  _candidates = [...MACOS_SYSTEM_FONTS, ...googleFamilies];
  return _candidates;
}

const MIN_TEXT_LENGTH = 3;

const _canvas = createCanvas(4000, 200);
const _ctx = _canvas.getContext('2d');
_ctx.textBaseline = 'alphabetic';

const LOG_DEST = '/tmp/font-detect.log';

function log(msg: string) {
  try { fs.appendFileSync(LOG_DEST, msg + '\n'); } catch {}
}

function detectItalicFromBboxes(charBboxes: Array<[number, number, number, number] | null>): boolean {
  const centers: number[] = [];
  for (const cb of charBboxes) {
    if (!cb) continue;
    centers.push(cb[1] + cb[3] / 2);
  }
  if (centers.length < 3) return false;
  let up = 0, down = 0;
  for (let i = 1; i < centers.length; i++) {
    const diff = centers[i] - centers[i - 1];
    if (diff > 1) down++;
    else if (diff < -1) up++;
  }
  return up > centers.length * 0.4 || down > centers.length * 0.4;
}

function widthMatchAll(
  text: string,
  bboxW: number,
  bboxH: number,
): { family: string; error: number; allSorted: { family: string; error: number }[] } {
  const fontSize = Math.max(8, bboxH);
  const candidates = listCandidates();
  const ctx = _ctx;

  const widthResults: { family: string; error: number }[] = [];
  for (const family of candidates) {
    try {
      ctx.font = `${fontSize}px "${family}"`;
      const renderedW = ctx.measureText(text).width;
      if (renderedW <= 0) continue;
      const error = Math.abs(renderedW - bboxW) / bboxW;
      widthResults.push({ family, error });
    } catch {}
  }
  widthResults.sort((a, b) => a.error - b.error);

  if (widthResults.length === 0) {
    return { family: 'Helvetica', error: 0, allSorted: [] };
  }

  return { family: widthResults[0].family, error: widthResults[0].error, allSorted: widthResults };
}

function otsuThreshold(data: Uint8ClampedArray, total: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < total; i++) {
    const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    hist[Math.round(lum)]++;
  }

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 0;

  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = i;
    }
  }

  return threshold;
}

export function computeBoldnessRatio(
  pageImage: Buffer,
  pixelBbox: [number, number, number, number],
): { ratio: number; height: number } | null {
  const img = decodePageImage(pageImage);
  if (!img) return null;

  let [bx, by, bw, bh] = pixelBbox;
  bx = Math.max(0, Math.floor(bx) - 2);
  by = Math.max(0, Math.floor(by) - 2);
  bw = Math.min(Math.ceil(bw) + 4, img.width - bx);
  bh = Math.min(Math.ceil(bh) + 4, img.height - by);
  if (bw < 4 || bh < 4) return null;

  const c = createCanvas(bw, bh);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, bx, by, bw, bh, 0, 0, bw, bh);
  const imageData = ctx.getImageData(0, 0, bw, bh);
  const data = imageData.data;
  const total = bw * bh;

  const threshold = otsuThreshold(data, total);

  let minY = bh, maxY = 0, minX = bw, maxX = 0;
  const binary = new Uint8Array(total);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const idx = y * bw + x;
      const lum = 0.299 * data[idx * 4] + 0.587 * data[idx * 4 + 1] + 0.114 * data[idx * 4 + 2];
      binary[idx] = lum < threshold ? 1 : 0;
      if (binary[idx]) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }

  if (maxY <= minY || maxX <= minX) return null;

  const inkHeight = maxY - minY + 1;

  // Median horizontal run-length = stroke width
  const runLengths: number[] = [];
  for (let y = minY; y <= maxY; y++) {
    let count = 0;
    for (let x = minX; x <= maxX; x++) {
      if (binary[y * bw + x]) {
        count++;
      } else if (count > 0) {
        runLengths.push(count);
        count = 0;
      }
    }
    if (count > 0) runLengths.push(count);
  }

  if (runLengths.length === 0) return null;

  runLengths.sort((a, b) => a - b);
  const mid = Math.floor(runLengths.length / 2);
  const strokeWidth = runLengths.length % 2 === 0
    ? (runLengths[mid - 1] + runLengths[mid]) / 2
    : runLengths[mid];

  return { ratio: strokeWidth / inkHeight, height: inkHeight };
}

const ERROR_THRESHOLD = 0.25;

export function detectFont(
  content: string,
  bboxW: number,
  bboxH: number,
  pageImage?: Buffer,
  pixelBbox?: [number, number, number, number],
  charBboxes?: Array<[number, number, number, number] | null>,
  renderScale: number = 1,
): { font: string; bold: boolean; italic: boolean; error: number } {
  const text = content.trim();
  if (!text || text.length < MIN_TEXT_LENGTH || bboxW < 5 || bboxH < 5) {
    log(`SKIP "${content}" w=${bboxW} h=${bboxH} — too short/small → Helvetica`);
    return { font: 'Helvetica', bold: false, italic: false, error: 0 };
  }

  const fontSize = Math.max(8, bboxH);
  log(`--- "${text}" w=${bboxW} h=${bboxH} fontSize=${fontSize} ---`);

  // Phase 1: Width matching across all candidates
  const widthResults = widthMatchAll(text, bboxW, bboxH);
  const allSorted = widthResults.allSorted;

  if (allSorted.length === 0 || allSorted[0].error > ERROR_THRESHOLD) {
    log(`  → All width errors >25% → Helvetica`);
    return { font: 'Helvetica', bold: false, italic: false, error: 0 };
  }

  let bestFamily = allSorted[0].family;
  let bestError = allSorted[0].error;
  log(`  Width top: ${allSorted.slice(0, 3).map(c => `${c.family}=${(c.error*100).toFixed(1)}%`).join(', ')}`);

  // Phase 3: Bold detection via pixel density
  let bestBold = false;
  let bestItalic = false;

  if (pageImage && pixelBbox) {
    const ocrDensity = measureWordDarkDensity(pageImage, pixelBbox);
    if (ocrDensity > 0) {
      const renderPx = Math.max(8, Math.round(bboxH * renderScale));

      const candidatesToCheck = [bestFamily];
      for (const c of allSorted.slice(0, 3)) {
        if (!candidatesToCheck.includes(c.family)) candidatesToCheck.push(c.family);
      }

      for (const candFamily of candidatesToCheck.slice(0, 3)) {
        const regFamily = candFamily;
        const boldFamily = candFamily + '-Bold';

        let regDensity = 0;
        try {
          const c = createCanvas(1, 1);
          const cx = c.getContext('2d');
          cx.font = `${renderPx}px "${regFamily}"`;
          const m = cx.measureText(text);
          const rw = Math.max(1, Math.ceil(m.width));
          c.width = rw; c.height = renderPx + 8;
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, rw, renderPx + 8);
          cx.fillStyle = '#000';
          cx.font = `${renderPx}px "${regFamily}"`;
          cx.textBaseline = 'alphabetic';
          cx.fillText(text, 2, renderPx - 2);
          regDensity = countDarkDensity(cx, rw, renderPx + 8);
        } catch { continue; }

        let boldDensity = 0;
        try {
          const c2 = createCanvas(1, 1);
          const cx2 = c2.getContext('2d');
          cx2.font = `${renderPx}px "${boldFamily}"`;
          const m2 = cx2.measureText(text);
          const bw = Math.max(1, Math.ceil(m2.width));
          c2.width = bw; c2.height = renderPx + 8;
          cx2.fillStyle = '#fff'; cx2.fillRect(0, 0, bw, renderPx + 8);
          cx2.fillStyle = '#000';
          cx2.font = `${renderPx}px "${boldFamily}"`;
          cx2.textBaseline = 'alphabetic';
          cx2.fillText(text, 2, renderPx - 2);
          boldDensity = countDarkDensity(cx2, bw, renderPx + 8);
        } catch {
          try {
            const c2 = createCanvas(1, 1);
            const cx2 = c2.getContext('2d');
            cx2.font = `bold ${renderPx}px "${regFamily}"`;
            const m2 = cx2.measureText(text);
            const bw = Math.max(1, Math.ceil(m2.width));
            c2.width = bw; c2.height = renderPx + 8;
            cx2.fillStyle = '#fff'; cx2.fillRect(0, 0, bw, renderPx + 8);
            cx2.fillStyle = '#000';
            cx2.font = `bold ${renderPx}px "${regFamily}"`;
            cx2.textBaseline = 'alphabetic';
            cx2.fillText(text, 2, renderPx - 2);
            boldDensity = countDarkDensity(cx2, bw, renderPx + 8);
          } catch {}
        }

        if (boldDensity > 0 && regDensity > 0 && boldDensity !== regDensity) {
          const regDiff = Math.abs(ocrDensity - regDensity);
          const boldDiff = Math.abs(ocrDensity - boldDensity);
          log(`    ${candFamily}: ocrDens=${ocrDensity.toFixed(4)} regDens=${regDensity.toFixed(4)} boldDens=${boldDensity.toFixed(4)} regDiff=${(regDiff*100).toFixed(2)}% boldDiff=${(boldDiff*100).toFixed(2)}%`);
          if (boldDiff < regDiff) {
            bestBold = true;
            bestError = allSorted.find(c => c.family === bestFamily)?.error ?? bestError;
          }
        }
      }
    }
  }

  // Phase 4: Italic detection via character bbox vertical drift
  if (charBboxes && charBboxes.length >= 3) {
    bestItalic = detectItalicFromBboxes(charBboxes);
    log(`  Italic: ${bestItalic} (drift check)`);
  }

  log(`  → ${bestFamily} b=${bestBold} i=${bestItalic} err=${(bestError * 100).toFixed(1)}%`);
  return { font: bestFamily, bold: bestBold, italic: bestItalic, error: bestError };
}
