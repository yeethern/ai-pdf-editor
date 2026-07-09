import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { createCanvas } from 'canvas';
import { PDFDocument, PDFPage, TextElement, PageElement, ColumnBoundary, DetectedQRCode } from '../../types';
import { ocrPage, splitCrossColumnItems, getRecommendedScale } from './ocr';
import { detectQRCode } from './qrDetector';
import { renderPage } from './renderer';
import { groupElements, LogFn } from '../ai/service';

const pdfjsLib = require('pdfjs-dist');

interface PDFTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
  dir?: string;
}

interface TextContent {
  items: PDFTextItem[];
}

function normalizeBBox(
  item: PDFTextItem,
  pageWidth: number,
  pageHeight: number
): [number, number, number, number] {
  const tx = item.transform[4];
  const ty = item.transform[5];
  const fontSize = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);

  const charWidth = item.width || (item.str.length * fontSize * 0.5);

  return [
    Math.round(tx),
    Math.round(pageHeight - ty - fontSize),
    Math.round(charWidth + 1),
    Math.round(fontSize + 2),
  ];
}

function detectTableColumns(
  pageWidth: number,
  pageHeight: number,
  canvas: any,
  canvasScale: number,
  onLog?: LogFn,
): ColumnBoundary[] | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data: Uint8ClampedArray = imageData.data;

  const projection = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let darkCount = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < 200) darkCount++;
    }
    projection[x] = darkCount / h;
  }

  const smoothed = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let sum = 0, count = 0;
    for (let dx = -1; dx <= 1; dx++) {
      const sx = x + dx;
      if (sx >= 0 && sx < w) { sum += projection[sx]; count++; }
    }
    smoothed[x] = sum / count;
  }

  type Region = { type: 'gutter' | 'content' | 'rule'; start: number; end: number };
  const regions: Region[] = [];
  let i = 0;
  while (i < w) {
    const val = smoothed[i];
    if (val < 0.02) {
      const start = i;
      while (i < w && smoothed[i] < 0.02) i++;
      regions.push({ type: 'gutter', start, end: i });
    } else if (val > 0.15) {
      const start = i;
      while (i < w && smoothed[i] > 0.15) i++;
      const width = i - start;
      regions.push({ type: width <= 4 ? 'rule' : 'content', start, end: i });
    } else {
      i++;
    }
  }

  const boundaries: ColumnBoundary[] = [];

  // Gutters between content regions → column gaps
  const contentRegions = regions.filter(r => r.type === 'content');
  for (let i = 1; i < contentRegions.length; i++) {
    boundaries.push({
      left: Math.round(contentRegions[i - 1].end / canvasScale),
      right: Math.round(contentRegions[i].start / canvasScale),
    });
  }

  // Thin vertical rules → explicit boundaries too
  for (const region of regions) {
    if (region.type === 'rule') {
      boundaries.push({
        left: Math.round(region.start / canvasScale),
        right: Math.round(region.end / canvasScale),
      });
    }
  }

  if (boundaries.length > 0) {
    const canvasMsg = `📊 Canvas: ${boundaries.length} column gaps detected`;
    console.log(`  ${canvasMsg}`);
    onLog?.('page', canvasMsg);
  }
  return boundaries.length > 0 ? boundaries : null;
}

function detectColumnsByAlignment(elements: TextElement[], onLog?: LogFn): ColumnBoundary[] | null {
  if (elements.length < 4) return null;

  const avgFs = elements.reduce((s, e) => s + (e.fontSize || 0), 0) / elements.length;
  const yThreshold = Math.max(3, Math.min(avgFs * 0.4, 12));

  const sorted = [...elements].sort((a, b) => a.bbox[1] - b.bbox[1]);
  const rows: TextElement[][] = [];
  let currentRow: TextElement[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].bbox[1] - currentRow[0].bbox[1]) < yThreshold) {
      currentRow.push(sorted[i]);
    } else {
      currentRow.sort((a, b) => a.bbox[0] - b.bbox[0]);
      rows.push(currentRow);
      currentRow = [sorted[i]];
    }
  }
  currentRow.sort((a, b) => a.bbox[0] - b.bbox[0]);
  rows.push(currentRow);

  const tableRows = rows.filter(r => r.length >= 2);
  if (tableRows.length < 2) return null;

  const leftCounts = new Map<number, number>();
  const rightCounts = new Map<number, number>();

  for (const row of tableRows) {
    for (const el of row) {
      const l = Math.round(el.bbox[0] / 5) * 5;
      const r = Math.round((el.bbox[0] + el.bbox[2]) / 5) * 5;
      leftCounts.set(l, (leftCounts.get(l) || 0) + 1);
      rightCounts.set(r, (rightCounts.get(r) || 0) + 1);
    }
  }

  const lefts = [...leftCounts.entries()]
    .filter(([_, c]) => c >= 2)
    .map(([p]) => p)
    .sort((a, b) => a - b);

  if (lefts.length < 2) return null;

  const boundaries: ColumnBoundary[] = [];
  for (let i = 1; i < lefts.length; i++) {
    boundaries.push({ left: lefts[i - 1], right: lefts[i] });
  }
  if (onLog) {
    const colStarts = lefts;
    const assignCol = (el: TextElement): number => {
      for (let c = colStarts.length - 1; c >= 0; c--) {
        if (el.bbox[0] >= colStarts[c] - 3) return c;
      }
      return 0;
    };

    const allRows = rows.length > 0
      ? rows
      : [sorted.sort((a, b) => a.bbox[0] - b.bbox[0])];

    const grid: (string | null)[][] = [];
    for (const row of allRows) {
      const sortedRow = [...row].sort((a, b) => a.bbox[0] - b.bbox[0]);
      const gridRow: (string | null)[] = new Array(colStarts.length).fill(null);
      for (const el of sortedRow) {
        gridRow[assignCol(el)] = el.content;
      }
      grid.push(gridRow);
    }

    const trunc = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + '…';
    const tableRowsOnly = grid.filter(r => r.filter(c => c && c.trim()).length >= 2);
    if (tableRowsOnly.length === 0) {
      console.log(`  📊 No table detected (no row with ≥2 filled cells)`);
      onLog?.('page', '📊 No table detected');
    } else {
      const activeCols = colStarts.map((_, ci) =>
        tableRowsOnly.some(r => r[ci] && r[ci].trim())
      );
      const colMap = activeCols.map((a, i) => a ? i : -1).filter(i => i >= 0);
      const nCols = colMap.length;

      const truncated = tableRowsOnly.map(row =>
        colMap.map(ci => row[ci] ? trunc(row[ci]!, 15) : '')
      );

      const colWidths = colMap.map((ci, cj) =>
        Math.max(3, ...truncated.map(r => r[cj].length))
      );
      const cw = colWidths.map(w => w + 2);

      const tableMsg = `📊 Table: ${tableRowsOnly.length} rows × ${nCols} cols`;
      console.log(`  ${tableMsg}`);
      onLog?.('page', tableMsg);

      const top = '┌' + cw.map(w => '─'.repeat(w)).join('┬') + '┐';
      console.log(`  ${top}`);
      onLog?.('page', '  ' + top);

      for (let ri = 0; ri < truncated.length; ri++) {
        const cells = truncated[ri].map((val, cj) => ' ' + val.padEnd(cw[cj] - 2) + ' ');
        const line = '  │' + cells.join('│') + '│';
        console.log(line);
        onLog?.('page', line);
        if (ri === 0 && truncated.length > 1) {
          const sep = '├' + cw.map(w => '─'.repeat(w)).join('┼') + '┤';
          console.log(`  ${sep}`);
          onLog?.('page', '  ' + sep);
        }
      }

      const bottom = '└' + cw.map(w => '─'.repeat(w)).join('┴') + '┘';
      console.log(`  ${bottom}`);
      onLog?.('page', '  ' + bottom);
    }
  }

  return boundaries;
}

function mergeLineElements(elements: TextElement[], columnBoundaries?: ColumnBoundary[] | null): TextElement[] {
  if (elements.length === 0) return elements;

  const avgFs = elements.reduce((s, e) => s + (e.fontSize || 0), 0) / elements.length;
  const yThreshold = Math.max(3, Math.min(avgFs * 0.4, 12));
  const xThreshold = Math.max(20, avgFs);

  const sorted = [...elements].sort((a, b) => {
    const yDiff = a.bbox[1] - b.bbox[1];
    if (Math.abs(yDiff) > yThreshold) return yDiff;
    return a.bbox[0] - b.bbox[0];
  });

  const lines: TextElement[] = [];
  let current: TextElement | null = null;

  for (const el of sorted) {
    if (!current) {
      current = { ...el };
      continue;
    }

    const sameLine = Math.abs(el.bbox[1] - current.bbox[1]) < yThreshold;
    const adjacent = el.bbox[0] - (current.bbox[0] + current.bbox[2]) < xThreshold;

    if (sameLine && adjacent) {
      if (columnBoundaries) {
        const overLeft = current.bbox[0];
        const overRight = el.bbox[0] + el.bbox[2];
        const crossesBoundary = columnBoundaries.some(
          b => overLeft < b.right && overRight > b.left
        );
        if (crossesBoundary) {
          lines.push(current);
          current = { ...el };
          continue;
        }
      }
      const newWidth: number = el.bbox[0] + el.bbox[2] - current.bbox[0];
      const gap: number = el.bbox[0] - (current.bbox[0] + current.bbox[2]);
      const sep: string = gap > 0 ? ' ' : '';
      current = {
        ...current,
        content: current.content + sep + el.content,
        bbox: [current.bbox[0], current.bbox[1], newWidth, current.bbox[3]],
      };
    } else {
      lines.push(current);
      current = { ...el };
    }
  }

  if (current) lines.push(current);
  return lines;
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

function groupIntoParagraphs(elements: TextElement[]): TextElement[][] {
  if (elements.length === 0) return [];
  const sorted = [...elements].sort((a, b) => {
    const yd = a.bbox[1] - b.bbox[1];
    if (Math.abs(yd) > 1) return yd;
    return a.bbox[0] - b.bbox[0];
  });
  const paragraphs: TextElement[][] = [];
  let current: TextElement[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const el = sorted[i];
    const gap = el.bbox[1] - (prev.bbox[1] + prev.bbox[3]);
    const lineHeight = Math.max(prev.bbox[3], el.bbox[3]);
    const sameParagraph = gap < lineHeight * 1.5;
    const fontOk = Math.abs((el.fontSize || 0) - (prev.fontSize || 0)) <= 3;
    if (sameParagraph && fontOk) {
      current.push(el);
    } else {
      paragraphs.push(current);
      current = [el];
    }
  }
  paragraphs.push(current);
  return paragraphs;
}

function computeAlignment(paragraph: TextElement[], pageWidth: number): 'left' | 'center' | 'right' {
  if (paragraph.length === 0) return 'left';
  const lefts = paragraph.map(el => el.bbox[0]);
  const centers = paragraph.map(el => el.bbox[0] + el.bbox[2] / 2);
  const rights = paragraph.map(el => el.bbox[0] + el.bbox[2]);
  const leftVar = variance(lefts);
  const centerVar = variance(centers);
  const rightVar = variance(rights);
  if (paragraph.length === 1) {
    const el = paragraph[0];
    const elCenter = el.bbox[0] + el.bbox[2] / 2;
    const pageCenter = pageWidth / 2;
    const distFromCenter = Math.abs(elCenter - pageCenter);
    if (distFromCenter < pageWidth * 0.05 && el.bbox[2] < pageWidth * 0.6) {
      return 'center';
    }
    return 'left';
  }
  const minVar = Math.min(leftVar, centerVar, rightVar);
  if (minVar > 100) return 'left';
  if (leftVar === minVar) return 'left';
  if (centerVar === minVar) return 'center';
  return 'right';
}

async function detectParagraphAlignment(
  elements: TextElement[],
  pageWidth: number,
  pageHeight: number,
  onLog?: import('../ai/service').LogFn,
): Promise<void> {
  if (elements.length === 0) return;

  const input = elements.map(el => ({
    content: el.content,
    x: el.bbox[0],
    y: el.bbox[1],
    fontSize: el.fontSize || 11,
  }));

  const result = await groupElements(input, pageWidth, pageHeight, onLog);

  const assigned = new Set<number>();
  for (let gi = 0; gi < result.groups.length; gi++) {
    const g = result.groups[gi];
    if (g.indices.length === 0) continue;
    const groupEls = g.indices
      .filter(idx => idx >= 0 && idx < elements.length)
      .map(idx => elements[idx]);
    g.indices.forEach(idx => assigned.add(idx));
    const align = g.isTable ? 'center' : computeAlignment(groupEls, pageWidth);
    let line = `  Group ${gi} [${align}]${g.isTable ? ' [TABLE]' : ''}:`;
    for (const el of groupEls) {
      el.alignment = align;
      el.groupIndex = gi;
      (el as any).isTable = g.isTable;
      const snippet = el.content.length > 50 ? el.content.substring(0, 50) + '...' : el.content;
      line += ` "${snippet}"`;
    }
    console.log(line);
    onLog?.('group', line.replace(/^  /, ''));
  }

  // Ungrouped elements become their own groups
  for (let i = 0; i < elements.length; i++) {
    if (!assigned.has(i)) {
      elements[i].alignment = computeAlignment([elements[i]], pageWidth);
      elements[i].groupIndex = -1;
      const soloMsg = `Solo [${elements[i].alignment}]: "${elements[i].content.substring(0, 50)}"`;
      console.log(`  ${soloMsg}`);
      onLog?.('group', soloMsg);
    }
  }
}

const originalPaths = new Map<string, string>();

export function getOriginalPath(docId: string): string | undefined {
  return originalPaths.get(docId);
}

async function detectQRCodesForDoc(docId: string, procCount: number, onLog?: LogFn): Promise<DetectedQRCode[]> {
  const filePath = getOriginalPath(docId);
  if (!filePath) return [];

  const allQRCodes: DetectedQRCode[] = [];
  for (let i = 1; i <= procCount; i++) {
    try {
      const renderScale = 0.75;
      const buffer = await renderPage(filePath, i, renderScale);
      const qrCodes = await detectQRCode(buffer, renderScale, i - 1);
      allQRCodes.push(...qrCodes);
    } catch (e) {
      console.error(`QR detection failed for page ${i}:`, e);
    }
  }

  if (allQRCodes.length > 0) {
    const qrMsg = `QR detection: found ${allQRCodes.length} code${allQRCodes.length !== 1 ? 's' : ''} across ${procCount} pages`;
    console.log(qrMsg);
    onLog?.('page', qrMsg);
  }

  return allQRCodes;
}

async function processOnePage(page: any, pageNum: number, pageWidth: number, pageHeight: number, onLog?: import('../ai/service').LogFn): Promise<PageElement[]> {
  const textContent: TextContent = await page.getTextContent();
  let rawElements: TextElement[] = [];
  let columnBoundaries: ColumnBoundary[] | null = null;

  for (const item of textContent.items) {
    const str = item.str?.trim();
    if (!str) continue;

    const fontSize = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);
    const bbox = normalizeBBox(item, pageWidth, pageHeight);

    rawElements.push({
      id: uuid(),
      type: 'text',
      content: item.str,
      bbox,
      font: item.fontName || 'Helvetica',
      fontSize: Math.round(fontSize * 10) / 10,
      editable: true,
      page: pageNum,
      style: {
        bold: item.fontName?.includes('Bold') || false,
        italic: item.fontName?.includes('Italic') || false,
        underline: false,
      },
    });
  }

  if (rawElements.length === 0) {
    const ocrScale = getRecommendedScale();
    const ocrEngine = ocrScale === 1.25 ? 'macOS Vision' : 'Tesseract.js';
    const ocrMsg = `Page ${pageNum + 1}: no text layer, running OCR (${ocrEngine})...`;
    console.log(ocrMsg);
    onLog?.('page', ocrMsg);
    const vp = page.getViewport({ scale: ocrScale });
    const canvas = createCanvas(vp.width, vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, vp.width, vp.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const jpegBuf = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    const ocrItems = await ocrPage(jpegBuf, ocrScale, pageWidth, pageHeight);
    const ocrFoundMsg = `Page ${pageNum + 1}: OCR found ${ocrItems.length} words`;
    console.log(ocrFoundMsg);
    onLog?.('page', ocrFoundMsg);

    // columnBoundaries = detectTableColumns(pageWidth, pageHeight, canvas, ocrScale, onLog);
    // rawElements = splitCrossColumnItems(ocrItems, columnBoundaries, ocrScale);
    rawElements = ocrItems;
    columnBoundaries = null;
  } else {
    columnBoundaries = detectColumnsByAlignment(rawElements, onLog);
    if (columnBoundaries) {
      const alignMsg = `Page ${pageNum + 1}: alignment detection ON (${columnBoundaries.length} column boundaries)`;
      console.log(alignMsg);
      onLog?.('page', alignMsg);
    }
  }

  if (rawElements.length > 0) {
    const first5 = rawElements.slice(0, 5).map(e => `"${e.content.substring(0, 30)}" bbox=[${e.bbox}] font=${e.fontSize}`);
    const itemsMsg = `Page ${pageNum + 1}: ${rawElements.length} raw items`;
    console.log(`${itemsMsg}, first: ${first5.join(' | ')}`);
    onLog?.('page', itemsMsg);
  }

  const merged = mergeLineElements(rawElements, columnBoundaries);
  await detectParagraphAlignment(merged, pageWidth, pageHeight, onLog);
  return merged;
}

async function withPool<T>(tasks: (() => Promise<T>)[], pool: number): Promise<(T | Error)[]> {
  const results: (T | Error)[] = [];
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= tasks.length) break;
      try {
        results[idx] = await tasks[idx]();
      } catch (err) {
        results[idx] = err as Error;
        console.error(`Task ${idx} failed:`, err);
      }
    }
  }

  const workers = Array.from({ length: Math.min(pool, tasks.length) }, () => worker());
  await Promise.allSettled(workers);
  return results;
}

function buildDocSkeleton(docId: string, docName: string, pages: PDFPage[], pageCount: number): PDFDocument {
  return {
    id: docId,
    name: docName,
    pages,
    metadata: { pageCount, title: docName },
    overlays: [],
    detectedQRCodes: [],
  };
}

export async function parsePDF(
  filePath: string,
  maxPages?: number,
  onLog?: import('../ai/service').LogFn,
  onEarlyDoc?: (doc: PDFDocument) => void
): Promise<PDFDocument> {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData: Uint8Array = new Uint8Array(dataBuffer.buffer, dataBuffer.byteOffset, dataBuffer.byteLength);
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const pageCount = pdf.numPages;

  const docId = uuid();
  const docName = path.basename(filePath);
  originalPaths.set(docId, filePath);

  // Pre-allocate all pages with skeleton dimensions (fast, sequential)
  const pages: PDFPage[] = new Array(pageCount);
  for (let i = 0; i < pageCount; i++) {
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1 });
    pages[i] = { elements: [], width: Math.round(viewport.width), height: Math.round(viewport.height) };
  }

  // Build tasks for ALL pages
  let earlyFired = false;
  const tasks: (() => Promise<void>)[] = [];
  for (let i = 0; i < pageCount; i++) {
    const pageIdx = i;
    tasks.push(async () => {
      const page = await pdf.getPage(pageIdx + 1);
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = Math.round(viewport.width);
      const pageHeight = Math.round(viewport.height);

      const startMsg = `Processing page ${pageIdx + 1}/${pageCount}...`;
      console.log(startMsg);
      onLog?.('page', startMsg);
      const elements = await processOnePage(page, pageIdx, pageWidth, pageHeight, onLog);

      pages[pageIdx] = { elements, width: pageWidth, height: pageHeight };

      // Preview opens after page 2 (index 1) finishes
      if (pageIdx === 1 && !earlyFired && onEarlyDoc) {
        earlyFired = true;
        onEarlyDoc(buildDocSkeleton(docId, docName, pages, pageCount));
      }
    });
  }

  // ALL pages run through 5-concurrency pool
  await withPool(tasks, 5);

  // If page 2 never fired (doc < 2 pages), fire onEarlyDoc now
  if (!earlyFired && onEarlyDoc) {
    earlyFired = true;
    onEarlyDoc(buildDocSkeleton(docId, docName, pages, pageCount));
  }

  const detectedQRCodes = await detectQRCodesForDoc(docId, pageCount, onLog);

  return buildDocSkeleton(docId, docName, pages, pageCount);
}

export async function processPage(pageIndex: number, document: PDFDocument, onLog?: import('../ai/service').LogFn): Promise<PageElement[]> {
  const filePath = originalPaths.get(document.id);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Original PDF not found');
  }

  const dataBuffer = fs.readFileSync(filePath);
  const pdfData: Uint8Array = new Uint8Array(dataBuffer.buffer, dataBuffer.byteOffset, dataBuffer.byteLength);
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const pdfPage = await pdf.getPage(pageIndex + 1);
  const viewport = pdfPage.getViewport({ scale: 1 });
  const pageWidth = Math.round(viewport.width);
  const pageHeight = Math.round(viewport.height);

  const elements = await processOnePage(pdfPage, pageIndex, pageWidth, pageHeight, onLog);

  // Also run QR detection for this page
  try {
    const renderScale = 0.75;
    const buffer = await renderPage(filePath, pageIndex + 1, renderScale);
    const qrCodes = await detectQRCode(buffer, renderScale, pageIndex);
    if (qrCodes.length > 0) {
      const existing = document.detectedQRCodes || [];
      const filtered = existing.filter(q => q.page !== pageIndex);
      document.detectedQRCodes = [...filtered, ...qrCodes];
      const qrMsg = `QR detection: found ${qrCodes.length} code${qrCodes.length !== 1 ? 's' : ''} on page ${pageIndex + 1}`;
      console.log(qrMsg);
      onLog?.('page', qrMsg);
    }
  } catch (e) {
    console.error(`QR detection failed for page ${pageIndex}:`, e);
  }

  return elements;
}

export function saveDocument(document: PDFDocument): void {
  const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'documents');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(dir, `${document.id}.json`),
    JSON.stringify(document, null, 2)
  );
}

export function loadDocument(docId: string): PDFDocument | null {
  const filePath = path.join(__dirname, '..', '..', '..', 'uploads', 'documents', `${docId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function updateElement(
  document: PDFDocument,
  pageIndex: number,
  elementId: string,
  updates: Partial<PageElement>
): PDFDocument {
  const page = document.pages[pageIndex];
  if (!page) return document;

  const idx = page.elements.findIndex((e) => e.id === elementId);
  if (idx === -1) return document;

  page.elements[idx] = { ...page.elements[idx], ...updates } as PageElement;
  return document;
}
