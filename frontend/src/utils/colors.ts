export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

export function medianPixel(pixels: { r: number; g: number; b: number }[]): { r: number; g: number; b: number } {
  const sorted = [...pixels].sort((a, b) => (a.r + a.g + a.b) - (b.r + b.g + b.b));
  return sorted[Math.floor(sorted.length / 2)];
}

export function sampleColors(imageData: ImageData): { bg: string; fg: string } {
  const d = imageData.data;
  const w = imageData.width, h = imageData.height;

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

  const extreme = textPixels.reduce((best, p) => {
    const bestLum = 0.299 * best.r + 0.587 * best.g + 0.114 * best.b;
    const pLum = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
    if (bgLum > 128) return pLum < bestLum ? p : best; // light bg → pick darkest
    return pLum > bestLum ? p : best;                   // dark bg → pick lightest
  });
  return { bg: bgHex, fg: rgbToHex(extreme.r, extreme.g, extreme.b) };
}
