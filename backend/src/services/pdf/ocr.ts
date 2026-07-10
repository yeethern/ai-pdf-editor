import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Tesseract from 'tesseract.js';
import { v4 as uuid } from 'uuid';
import { detectFont, computeBoldnessRatio } from './fonts';
import { ColumnBoundary } from '../../types';

export interface OcrWordItem {
  id: string;
  type: 'text';
  content: string;
  bbox: [number, number, number, number];
  confidence: number;
  font: string;
  fontError?: number;
  fontSize: number;
  editable: boolean;
  style: { bold: boolean; italic: boolean; underline: boolean };
  charBboxes?: Array<[number, number, number, number] | null>;
}

const BIN_PATH = path.join(__dirname, '..', '..', '..', 'bin', 'vision-ocr.m');
const COMPILED_PATH = '/tmp/vision-ocr';

function isMacOS(): boolean {
  return process.platform === 'darwin' && fs.existsSync('/usr/bin/clang');
}

export function getRecommendedScale(): number {
  return 2.0;
}

function ensureBinary(): string {
  if (fs.existsSync(COMPILED_PATH)) return COMPILED_PATH;
  if (fs.existsSync(BIN_PATH) && fs.existsSync('/usr/bin/clang')) {
    execFileSync('/usr/bin/clang', [
      '-framework', 'Foundation',
      '-framework', 'Vision',
      '-framework', 'Cocoa',
      '-o', COMPILED_PATH,
      BIN_PATH,
    ], { timeout: 30000, stdio: 'pipe' });
  }
  return COMPILED_PATH;
}

function applyFontEnsemble(results: OcrWordItem[]): void {
  const fontCounts = new Map<string, { count: number; totalError: number }>();
  for (const r of results) {
    const f = r.font;
    if (!fontCounts.has(f)) fontCounts.set(f, { count: 0, totalError: 0 });
    const e = fontCounts.get(f)!;
    e.count++;
    e.totalError += r.fontError || 0;
  }

  let topNonHelvetica = '', topCount = 0;
  for (const [f, { count }] of fontCounts) {
    if (f !== 'Helvetica' && count > topCount) { topNonHelvetica = f; topCount = count; }
  }

  const totalWords = results.length;
  if (totalWords >= 30 && topCount > 0 && topCount / totalWords > 0.25) {
    const avgError = (fontCounts.get(topNonHelvetica)?.totalError ?? 0) / topCount;
    for (const r of results) {
      if (r.font !== topNonHelvetica && r.font !== 'Helvetica') {
        if (r.fontError !== undefined && r.fontError > avgError + 0.03) {
          r.font = topNonHelvetica;
          r.fontError = avgError;
        }
      }
    }
  }
}

export function splitCrossColumnItems(
  items: OcrWordItem[],
  columnBoundaries: ColumnBoundary[] | null,
  renderScale: number,
): OcrWordItem[] {
  if (!columnBoundaries || columnBoundaries.length === 0) return items;

  const imgBoundaries = columnBoundaries.map(b => ({
    left: Math.round(b.left * renderScale),
    right: Math.round(b.right * renderScale),
  }));

  const result: OcrWordItem[] = [];

  for (const item of items) {
    if (!item.charBboxes || item.charBboxes.length < 2) {
      result.push(item);
      continue;
    }

    const splits: number[] = [];
    for (let i = 0; i < item.charBboxes.length; i++) {
      const cb = item.charBboxes[i];
      if (!cb) continue;
      const charRight = cb[0] + cb[2];
      for (const boundary of imgBoundaries) {
        if (charRight >= boundary.left && charRight <= boundary.right) {
          splits.push(i + 1);
          break;
        }
      }
    }

    if (splits.length === 0) {
      result.push(item);
      continue;
    }

    console.log(`splitCrossColumnItems: splitting "${item.content}" at char indices ${splits.join(', ')}`);

    let start = 0;
    for (const split of splits) {
      const segmentContent = item.content.slice(start, split);
      if (!segmentContent) { start = split; continue; }
      const segBboxes = item.charBboxes.slice(start, split).filter(Boolean) as [number, number, number, number][];
      if (segBboxes.length > 0) {
        const minX = Math.min(...segBboxes.map(b => b[0]));
        const minY = Math.min(...segBboxes.map(b => b[1]));
        const maxX = Math.max(...segBboxes.map(b => b[0] + b[2]));
        const maxY = Math.max(...segBboxes.map(b => b[1] + b[3]));
        result.push({
          ...item,
          id: uuid(),
          content: segmentContent,
          bbox: [minX, minY, maxX - minX, maxY - minY],
          charBboxes: item.charBboxes.slice(start, split),
        });
      }
      start = split;
    }

    const lastContent = item.content.slice(start);
    if (lastContent) {
      const segBboxes = item.charBboxes.slice(start).filter(Boolean) as [number, number, number, number][];
      if (segBboxes.length > 0) {
        const minX = Math.min(...segBboxes.map(b => b[0]));
        const minY = Math.min(...segBboxes.map(b => b[1]));
        const maxX = Math.max(...segBboxes.map(b => b[0] + b[2]));
        const maxY = Math.max(...segBboxes.map(b => b[1] + b[3]));
        result.push({
          ...item,
          id: uuid(),
          content: lastContent,
          bbox: [minX, minY, maxX - minX, maxY - minY],
          charBboxes: item.charBboxes.slice(start),
        });
      }
    }
  }

  return result;
}

function clusterBoldByOtsu(ratios: number[]): number {
  const sorted = [...ratios].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min;
  if (range < 0.02) return -1;

  const scaled = ratios.map(r => Math.round((r - min) / range * 255));
  const hist = new Uint32Array(256);
  for (const v of scaled) {
    hist[Math.min(255, Math.max(0, v))]++;
  }

  const total = scaled.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let otsuThreshold = 0;

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
      otsuThreshold = i;
    }
  }

  if (otsuThreshold === 0 || otsuThreshold >= 255) return -1;
  return min + (otsuThreshold / 255) * range;
}

function detectBoldFromPixels(
  results: OcrWordItem[],
  imageBuffer: Buffer,
  renderScale: number,
  rawBboxes: Array<[number, number, number, number]>,
): void {
  const ratios: (number | null)[] = [];
  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    if (item.content.length < 3) {
      ratios.push(null);
      continue;
    }
    try {
      const result = computeBoldnessRatio(imageBuffer, rawBboxes[i]);
      ratios.push(result ? result.ratio : null);
    } catch {
      ratios.push(null);
    }
  }

  const validRatios = ratios.filter((r): r is number => r !== null);
  if (validRatios.length < 4) return;

  const threshold = clusterBoldByOtsu(validRatios);
  if (threshold < 0) return;

  for (let i = 0; i < results.length; i++) {
    const ratio = ratios[i];
    if (ratio !== null && ratio > threshold) {
      results[i].style.bold = true;
    }
  }
}

async function ocrWithVision(imageBuffer: Buffer, renderScale: number): Promise<OcrWordItem[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
  const imgPath = path.join(tmpDir, 'page.png');

  try {
    fs.writeFileSync(imgPath, imageBuffer);
    const binary = ensureBinary();

    if (!fs.existsSync(binary)) {
      console.error('Vision OCR binary not found');
      return [];
    }

    const output = execFileSync(binary, [imgPath], {
      timeout: 30000,
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024,
    });

    const items = JSON.parse(output.toString('utf-8'));
    if (!Array.isArray(items)) return [];

    const rawBboxes: Array<[number, number, number, number]> = [];
    const results: OcrWordItem[] = await Promise.all(items.map(async (item: any) => {
      const content = (item.text || '').trim();
      const rawBbox: [number, number, number, number] = item.bbox;
      rawBboxes.push(rawBbox);
      const bbox: [number, number, number, number] = [
        Math.round(rawBbox[0] / renderScale),
        Math.round(rawBbox[1] / renderScale),
        Math.round(rawBbox[2] / renderScale),
        Math.round(rawBbox[3] / renderScale),
      ];
      const fontSize = Math.round(bbox[3]);
      const charBboxes: Array<[number, number, number, number] | null> | undefined =
        item.charBboxes?.map((cb: any) =>
          cb === null ? null : [Math.round(cb[0]), Math.round(cb[1]), Math.round(cb[2]), Math.round(cb[3])] as [number, number, number, number]
        );

      const { font, bold, italic, error } = await detectFont(content, bbox[2], bbox[3], undefined, undefined, charBboxes, renderScale);

      return {
        id: uuid(),
        type: 'text' as const,
        content,
        bbox,
        confidence: item.confidence || 0,
        font,
        fontError: error,
        fontSize,
        editable: true,
        style: { bold, italic, underline: false },
        charBboxes,
      };
    }));

    applyFontEnsemble(results);
    detectBoldFromPixels(results, imageBuffer, renderScale, rawBboxes);
    return results;
  } catch (e) {
    console.error('Vision OCR failed:', e);
    return [];
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

let _worker: Tesseract.Worker | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!_worker) {
    _worker = await Tesseract.createWorker('eng', 1);
  }
  return _worker;
}

async function ocrWithTesseract(imageBuffer: Buffer, renderScale: number): Promise<OcrWordItem[]> {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(imageBuffer, {}, { blocks: true });

    if (!data.blocks) return [];

    const rawBboxes: Array<[number, number, number, number]> = [];
    const results: OcrWordItem[] = [];

    for (const block of data.blocks) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          for (const word of line.words) {
            const content = (word.text || '').trim();
            if (!content) continue;

            const b = word.bbox;
            const rawBbox: [number, number, number, number] = [
              b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0,
            ];
            rawBboxes.push(rawBbox);
            const bbox: [number, number, number, number] = [
              Math.round(rawBbox[0] / renderScale),
              Math.round(rawBbox[1] / renderScale),
              Math.round(rawBbox[2] / renderScale),
              Math.round(rawBbox[3] / renderScale),
            ];
            const fontSize = Math.round(bbox[3]);
            const charBboxes: Array<[number, number, number, number] | null> =
              (word.symbols || []).map((s: any) => {
                if (!s || !s.bbox) return null;
                const sb = s.bbox;
                return [Math.round(sb.x0), Math.round(sb.y0), Math.round(sb.x1 - sb.x0), Math.round(sb.y1 - sb.y0)] as [number, number, number, number];
              });

            const { font, bold, italic, error } = await detectFont(
              content, bbox[2], bbox[3], undefined, undefined, charBboxes, renderScale,
            );

            results.push({
              id: uuid(),
              type: 'text',
              content,
              bbox,
              confidence: word.confidence / 100,
              font,
              fontError: error,
              fontSize,
              editable: true,
              style: { bold, italic, underline: false },
              charBboxes,
            });
          }
        }
      }
    }

    applyFontEnsemble(results);
    detectBoldFromPixels(results, imageBuffer, renderScale, rawBboxes);
    return results;
  } catch (e) {
    console.error('Tesseract OCR failed:', e);
    return [];
  }
}

export async function ocrPage(
  imageBuffer: Buffer,
  renderScale: number,
  pageWidth: number,
  pageHeight: number,
): Promise<OcrWordItem[]> {
  if (isMacOS()) {
    return ocrWithVision(imageBuffer, renderScale);
  }
  return ocrWithTesseract(imageBuffer, renderScale);
}
