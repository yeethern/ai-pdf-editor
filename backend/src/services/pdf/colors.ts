import { createCanvas, Image } from 'canvas';

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function medianPixel(pixels: { r: number; g: number; b: number }[]): { r: number; g: number; b: number } {
  const sorted = [...pixels].sort((a, b) => (a.r + a.g + a.b) - (b.r + b.g + b.b));
  return sorted[Math.floor(sorted.length / 2)];
}

export function sampleColors(data: Uint8ClampedArray, width: number, height: number): { bg: string; fg: string } {
  const d = data;
  const w = width;
  const h = height;

  const borderPixels: { r: number; g: number; b: number }[] = [];
  const addPixel = (i: number) => {
    if (d[i + 3] >= 128) borderPixels.push({ r: d[i], g: d[i + 1], b: d[i + 2] });
  };
  for (let x = 0; x < w; x++) { addPixel(x * 4); addPixel(((h - 1) * w + x) * 4); }
  for (let y = 1; y < h - 1; y++) { addPixel((y * w) * 4); addPixel((y * w + w - 1) * 4); }

  if (borderPixels.length < 4) return { bg: '#fff', fg: '#000' };

  const bgPix = medianPixel(borderPixels);
  const bgHex = rgbToHex(bgPix.r, bgPix.g, bgPix.b);
  const bgLum = 0.299 * bgPix.r + 0.587 * bgPix.g + 0.114 * bgPix.b;

  const textPixels: { r: number; g: number; b: number }[] = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (Math.abs(lum - bgLum) > 30) {
      textPixels.push({ r: d[i], g: d[i + 1], b: d[i + 2] });
    }
  }

  if (textPixels.length === 0) return { bg: bgHex, fg: '#000' };

  const fgPix = medianPixel(textPixels);
  return { bg: bgHex, fg: rgbToHex(fgPix.r, fgPix.g, fgPix.b) };
}

export async function extractElementColor(
  pageImageBuffer: Buffer,
  bbox: [number, number, number, number],
  renderScale: number = 2
): Promise<string> {
  const { fg } = await extractColors(pageImageBuffer, bbox, renderScale);
  return fg;
}

export async function extractColors(
  pageImageBuffer: Buffer,
  bbox: [number, number, number, number],
  renderScale: number = 2
): Promise<{ bg: string; fg: string }> {
  const img = new Image();
  img.src = pageImageBuffer;

  let [bx, by, bw, bh] = bbox;
  bx = Math.round(bx * renderScale);
  by = Math.round(by * renderScale);
  bw = Math.round(bw * renderScale);
  bh = Math.round(bh * renderScale);

  bx = Math.max(0, bx);
  by = Math.max(0, by);
  bw = Math.min(bw, img.width - bx);
  bh = Math.min(bh, img.height - by);

  if (bw < 2 || bh < 2) return { bg: '#fff', fg: '#000' };

  const c = createCanvas(bw, bh);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, bx, by, bw, bh, 0, 0, bw, bh);
  const imageData = ctx.getImageData(0, 0, bw, bh);
  return sampleColors(imageData.data, bw, bh);
}
