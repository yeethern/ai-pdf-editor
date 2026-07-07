import fs from 'fs';
import { createCanvas } from 'canvas';

const pdfjsLib = require('pdfjs-dist');

const pageCache = new Map<string, Buffer>();

export async function renderPage(pdfPath: string, pageNum: number, scale: number = 2): Promise<Buffer> {
  const cacheKey = `${pdfPath}:${pageNum}:${scale}`;
  const cached = pageCache.get(cacheKey);
  if (cached) return cached;

  const data = fs.readFileSync(pdfPath);
  const pdfData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  const buffer = canvas.toBuffer('image/png');
  pageCache.set(cacheKey, buffer);
  return buffer;
}
