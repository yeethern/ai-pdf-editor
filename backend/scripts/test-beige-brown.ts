import { createCanvas } from 'canvas';
import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';

const TEXT = 'Open closet bedroom storage';
const WORDS = TEXT.split(' ');

interface Bbox { x: number; y: number; w: number; h: number }

function measureWord(ctx: CanvasRenderingContext2D, word: string, x: number, y: number): Bbox {
  const m = ctx.measureText(word);
  return {
    x: Math.round(x + (m.actualBoundingBoxLeft || 0)),
    y: Math.round(y - m.actualBoundingBoxAscent),
    w: Math.round((m.actualBoundingBoxRight || m.width) - (m.actualBoundingBoxLeft || 0)),
    h: Math.round(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent),
  };
}

function drawWords(ctx: CanvasRenderingContext2D, words: string[], x: number, startY: number, lineHeight: number): Map<string, Bbox> {
  const expected = new Map<string, Bbox>();
  let y = startY;
  for (const word of words) {
    ctx.fillText(word, x, y);
    expected.set(word, measureWord(ctx, word, x, y));
    y += lineHeight;
  }
  return expected;
}

const FONT = '24px Arial';

const TEST_CASES: { name: string; bg: string; textColor: string }[] = [
  // Earth tones - brown backgrounds
  { name: 'beige-text-saddle-brown-bg',       bg: '#8B4513', textColor: '#F5F5DC' },
  { name: 'beige-text-sienna-bg',             bg: '#A0522D', textColor: '#FAEBD7' },
  { name: 'cream-text-maroon-bg',             bg: '#800000', textColor: '#FFFDD0' },
  { name: 'beige-text-dark-olive-bg',         bg: '#556B2F', textColor: '#F5F5DC' },
  { name: 'cream-text-brown-bg',              bg: '#654321', textColor: '#FFF8DC' },
  { name: 'warm-white-chocolate-bg',          bg: '#7B3F00', textColor: '#FFF5E1' },
  // Low contrast beige-on-beige
  { name: 'beige-text-beige-bg-low-contrast', bg: '#E8D5B7', textColor: '#D4C4A8' },
  { name: 'cream-text-tan-bg',                bg: '#D2B48C', textColor: '#FFF8DC' },
  // Reversed - brown text on beige bg
  { name: 'brown-text-beige-bg',              bg: '#F5F5DC', textColor: '#8B4513' },
  { name: 'dark-brown-text-cream-bg',         bg: '#FFFDD0', textColor: '#3E2723' },
  // More specific "poo" colors
  { name: 'beige-text-dirty-brown-bg',        bg: '#6B4423', textColor: '#F0E6D3' },
  { name: 'cream-text-mud-bg',                bg: '#5C4033', textColor: '#FFF8E7' },
  { name: 'beige-text-dark-khaki-bg',         bg: '#BDB76B', textColor: '#F5F5DC' },
  { name: 'cream-text-rust-bg',               bg: '#8B4513', textColor: '#FFFDD0' },
];

async function main() {
  const outputDir = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('Creating worker...\n');
  const worker = await Tesseract.createWorker('eng', 1);
  console.log('Worker ready\n');

  for (const tc of TEST_CASES) {
    const canvas = createCanvas(600, 200);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = tc.bg;
    ctx.fillRect(0, 0, 600, 200);
    ctx.fillStyle = tc.textColor;
    ctx.font = FONT;
    drawWords(ctx, WORDS, 30, 50, 35);

    const imgPath = path.join(outputDir, `beige-${tc.name}.png`);
    fs.writeFileSync(imgPath, canvas.toBuffer('image/png'));

    process.stdout.write(`  ${tc.name}...`);
    const { data } = await worker.recognize(imgPath, {}, { blocks: true });

    const tessWords: string[] = [];
    if (data.blocks) {
      for (const b of data.blocks)
        for (const p of b.paragraphs)
          for (const l of p.lines)
            for (const w of l.words)
              tessWords.push(w.text);
    }

    const tessFull = tessWords.join(' ');

    // Character accuracy
    let correct = 0;
    const ref = TEXT;
    for (let i = 0; i < Math.min(tessFull.length, ref.length); i++) {
      if (tessFull[i] === ref[i]) correct++;
    }
    const charAcc = Math.max(ref.length, tessFull.length) > 0
      ? correct / Math.max(ref.length, tessFull.length)
      : 0;

    const foundAll = WORDS.every(w => tessWords.some(t => t.toLowerCase() === w.toLowerCase()));
    const garbage = tessWords.filter(t => !WORDS.some(w => w.toLowerCase() === t.toLowerCase()));

    const marker = foundAll && garbage.length === 0 ? '✓' : '✗';
    console.log(` ${marker} ${tessFull.slice(0, 60)} (char:${(charAcc*100).toFixed(0)}%)`);
  }

  await worker.terminate();
}

main().catch(err => { console.error(err); process.exit(1); });
