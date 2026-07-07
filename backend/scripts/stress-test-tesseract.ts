import { createCanvas, CanvasRenderingContext2D, Canvas } from 'canvas';
import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';

interface Bbox { x: number; y: number; w: number; h: number }

interface TestCase {
  name: string;
  draw: (ctx: CanvasRenderingContext2D, canvas: Canvas) => { words: string[]; expected: Map<string, Bbox> };
}

interface ScenarioResult {
  scenario: string;
  wordsFound: number;
  wordsExpected: number;
  correctWords: string[];
  wrongWords: string[];
  missingWords: string[];
  tessOutput: string;
  avgConfidence: number;
  characterAccuracy: number;
}

const TEXT = 'Open closet bedroom storage';

function measureWord(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): Bbox {
  const m = ctx.measureText(text);
  return {
    x: Math.round(x + (m.actualBoundingBoxLeft || 0)),
    y: Math.round(y - m.actualBoundingBoxAscent),
    w: Math.round((m.actualBoundingBoxRight || m.width) - (m.actualBoundingBoxLeft || 0)),
    h: Math.round(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent),
  };
}

function measureWordRel(ctx: CanvasRenderingContext2D, word: string, x: number, y: number): Bbox {
  const m = ctx.measureText(word);
  return {
    x: Math.round(x + (m.actualBoundingBoxLeft || 0)),
    y: Math.round(y - m.actualBoundingBoxAscent),
    w: Math.round((m.actualBoundingBoxRight || m.width) - (m.actualBoundingBoxLeft || 0)),
    h: Math.round(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent),
  };
}

const FONT = '24px Arial';

// Shared draw helpers
function drawWords(ctx: CanvasRenderingContext2D, words: string[], x: number, startY: number, lineHeight: number): Map<string, Bbox> {
  const expected = new Map<string, Bbox>();
  let y = startY;
  for (const word of words) {
    ctx.fillText(word, x, y);
    expected.set(word, measureWordRel(ctx, word, x, y));
    y += lineHeight;
  }
  return expected;
}

function charDiff(actual: string, expected: string): number {
  let correct = 0;
  const maxLen = Math.max(actual.length, expected.length);
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) {
    if (actual[i] === expected[i]) correct++;
  }
  return maxLen > 0 ? correct / maxLen : 1;
}

const TEST_CASES: TestCase[] = [
  // === BASELINE ===
  {
    name: '01-white-bg-black-text',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  // === COLORED BACKGROUNDS ===
  {
    name: '02-light-gray-bg',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '03-dark-bg-white-text',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#222';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#fff';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '04-blue-bg-white-text',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#1a5276';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#fff';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '05-red-bg-yellow-text',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#f1c40f';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  // === COLORED TEXT ===
  {
    name: '06-white-bg-light-blue-text',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#5dade2';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '07-white-bg-light-gray-text',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#999';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '08-white-bg-very-light-gray-text',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#ccc';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  // === SHADOWS ===
  {
    name: '09-text-drop-shadow',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = FONT;
      let y = 50;
      for (const word of words) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.fillText(word, 30, y);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        y += 35;
      }
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '10-heavy-drop-shadow',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = FONT;
      let y = 50;
      for (const word of words) {
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        ctx.fillText(word, 30, y);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        y += 35;
      }
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  // === BORDERS / OUTLINES ===
  {
    name: '11-text-with-border-stroke',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.font = FONT;
      let y = 50;
      for (const word of words) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeText(word, 30, y);
        ctx.fillStyle = '#000';
        ctx.fillText(word, 30, y);
        y += 35;
      }
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '12-white-text-black-border',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 600, 200);
      ctx.font = FONT;
      let y = 50;
      for (const word of words) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeText(word, 30, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(word, 30, y);
        y += 35;
      }
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  // === LOW CONTRAST ===
  {
    name: '13-low-contrast-gray-on-gray',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#b0b0b0';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#808080';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '14-very-low-contrast',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#d0d0d0';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#c0c0c0';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  // === DIFFERENT FONTS ===
  {
    name: '15-serif-font',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = '24px "Times New Roman"';
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '16-bold-text',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 24px Arial';
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '17-italic-text',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = 'italic 24px Arial';
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  // === SMALL TEXT ===
  {
    name: '18-small-text-12px',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = '12px Arial';
      return { words, expected: drawWords(ctx, words, 30, 40, 18) };
    },
  },
  {
    name: '19-tiny-text-9px',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = '9px Arial';
      return { words, expected: drawWords(ctx, words, 30, 30, 14) };
    },
  },
  // === NOISY/PHOTO BACKGROUND ===
  {
    name: '20-noise-bg-black-text',
    draw: (ctx, canvas) => {
      const words = TEXT.split(' ');
      // Generate noise
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const v = Math.floor(180 + Math.random() * 60);
        imageData.data[i] = v;
        imageData.data[i+1] = v;
        imageData.data[i+2] = v;
        imageData.data[i+3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      ctx.fillStyle = '#000';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '21-heavy-noise-bg',
    draw: (ctx, canvas) => {
      const words = TEXT.split(' ');
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const v = Math.floor(100 + Math.random() * 155);
        imageData.data[i] = v;
        imageData.data[i+1] = v;
        imageData.data[i+2] = v;
        imageData.data[i+3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      ctx.fillStyle = '#000';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  // === JPEG COMPRESSION ARTIFACTS ===
  {
    name: '22-jpeg-artifacts',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
    // Will be saved as JPEG with low quality
  },
  // === INVERTED ===
  {
    name: '23-inverted-video',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#0f0';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '24-terminal-green-on-black',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#00ff00';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  // === UNDERLINE ===
  {
    name: '25-underlined-text',
    draw: (ctx) => {
      const words = TEXT.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = FONT;
      let y = 50;
      for (const word of words) {
        const m = ctx.measureText(word);
        ctx.fillText(word, 30, y);
        // Draw underline
        ctx.fillRect(30, y + 2, m.width, 1.5);
        y += 35;
      }
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  // === MIXED CASE SENSITIVITY ===
  {
    name: '26-all-caps',
    draw: (ctx) => {
      const words = 'OPEN CLOSET BEDROOM STORAGE'.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
  {
    name: '27-all-lowercase',
    draw: (ctx) => {
      const words = 'open closet bedroom storage'.split(' ');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = '#000';
      ctx.font = FONT;
      return { words, expected: drawWords(ctx, words, 30, 50, 35) };
    },
  },
];

function charLevelAccuracy(tessText: string, expectedText: string): number {
  let correct = 0;
  const len = Math.max(tessText.length, expectedText.length);
  for (let i = 0; i < Math.min(tessText.length, expectedText.length); i++) {
    if (tessText[i] === expectedText[i]) correct++;
  }
  return len > 0 ? correct / len : 1;
}

async function runTest(worker: Tesseract.Worker, imageBuffer: Buffer, scenario: string, isJpeg: boolean): Promise<ScenarioResult> {
  const ext = isJpeg ? 'jpg' : 'png';
  const tmpPath = path.join(__dirname, '..', 'uploads', `stress-${scenario}.${ext}`);
  fs.writeFileSync(tmpPath, imageBuffer);

  const { data } = await worker.recognize(tmpPath, {}, { blocks: true });

  const tessWords: { text: string; conf: number }[] = [];
  if (data.blocks) {
    for (const block of data.blocks)
      for (const para of block.paragraphs)
        for (const line of para.lines)
          for (const word of line.words)
            tessWords.push({ text: word.text, conf: word.confidence / 100 });
  }

  const expectedWords = scenario === '26-all-caps'
    ? 'OPEN CLOSET BEDROOM STORAGE'.split(' ')
    : scenario === '27-all-lowercase'
    ? 'open closet bedroom storage'.split(' ')
    : 'Open closet bedroom storage'.split(' ');

  const tessText = tessWords.map(w => w.text).join(' ');
  const expectedFullText = expectedWords.join(' ');

  const foundSet = new Set(tessWords.map(w => w.text.toLowerCase()));
  const correctWords: string[] = [];
  const wrongWords: string[] = [];
  const missingWords: string[] = [];

  for (const ew of expectedWords) {
    if (foundSet.has(ew.toLowerCase())) {
      correctWords.push(ew);
    } else {
      missingWords.push(ew);
    }
  }

  for (const tw of tessWords) {
    if (!expectedWords.find(ew => ew.toLowerCase() === tw.text.toLowerCase())) {
      wrongWords.push(tw.text);
    }
  }

  const avgConf = tessWords.length > 0
    ? tessWords.reduce((s, w) => s + w.conf, 0) / tessWords.length
    : 0;

  const charAcc = charLevelAccuracy(tessText, expectedFullText);

  return {
    scenario,
    wordsFound: tessWords.length,
    wordsExpected: expectedWords.length,
    correctWords: [...new Set(correctWords)],
    wrongWords: [...new Set(wrongWords)],
    missingWords,
    tessOutput: tessText || '(empty)',
    avgConfidence: avgConf,
    characterAccuracy: charAcc,
  };
}

async function main() {
  const outputDir = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('Creating Tesseract worker...\n');
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        process.stdout.write(`\r  Warmup: ${(m.progress * 100).toFixed(0)}%`);
      }
    },
  });
  process.stdout.write('\r  Warmup complete\n');

  // Warmup with a simple image
  const warmupCanvas = createCanvas(100, 50);
  const wctx = warmupCanvas.getContext('2d');
  wctx.fillStyle = '#fff';
  wctx.fillRect(0, 0, 100, 50);
  wctx.fillStyle = '#000';
  wctx.font = '20px Arial';
  wctx.fillText('warmup', 10, 30);
  const warmupBuf = warmupCanvas.toBuffer('image/png');
  const warmupPath = path.join(outputDir, '_warmup.png');
  fs.writeFileSync(warmupPath, warmupBuf);
  await worker.recognize(warmupPath, {}, { blocks: true });
  console.log('  Warmup done\n');

  const allResults: ScenarioResult[] = [];

  for (const tc of TEST_CASES) {
    const canvas = createCanvas(600, 200);
    const ctx = canvas.getContext('2d');
    const { words, expected } = tc.draw(ctx, canvas);

    let buffer: Buffer;
    let isJpeg = false;

    if (tc.name === '22-jpeg-artifacts') {
      // Save as JPEG at quality 30 to introduce artifacts
      buffer = canvas.toBuffer('image/jpeg', { quality: 30 });
      isJpeg = true;
    } else {
      buffer = canvas.toBuffer('image/png');
    }

    process.stdout.write(`  Testing: ${tc.name}...`);
    const result = await runTest(worker, buffer, tc.name, isJpeg);
    allResults.push(result);
    process.stdout.write(' done\n');
  }

  await worker.terminate();

  // Print results
  console.log('\n' + '='.repeat(140));
  console.log('  TESSERACT.JS STRESS TEST RESULTS');
  console.log('='.repeat(140));
  console.log(`  Target text: "${TEXT}"`);
  console.log(`\n  ${'#'.padEnd(4)} ${'Scenario'.padEnd(34)} ${'Found/Exp'.padEnd(12)} ${'Correct'.padEnd(22)} ${'Wrong/Garbage'.padEnd(22)} ${'Missing'.padEnd(22)} ${'Char%'.padEnd(8)} ${'Conf'}`);
  console.log(`  ${''.padEnd(4, '─')} ${''.padEnd(34, '─')} ${''.padEnd(12, '─')} ${''.padEnd(22, '─')} ${''.padEnd(22, '─')} ${''.padEnd(22, '─')} ${''.padEnd(8, '─')} ${''.padEnd(4, '─')}`);

  let passCount = 0;
  for (const r of allResults) {
    const num = allResults.indexOf(r) + 1;
    const foundStr = `${r.wordsFound}/${r.wordsExpected}`;
    const correctStr = r.correctWords.join(', ').slice(0, 20) || '(none)';
    const wrongStr = r.wrongWords.join(', ').slice(0, 20) || '(none)';
    const missingStr = r.missingWords.join(', ').slice(0, 20) || '(none)';
    const charPct = (r.characterAccuracy * 100).toFixed(1);
    const confPct = (r.avgConfidence * 100).toFixed(1);

    const allCorrect = r.missingWords.length === 0 && r.wrongWords.length === 0;
    if (allCorrect) passCount++;

    const marker = allCorrect ? '✓' : '✗';
    console.log(`  ${num}. ${marker} ${r.scenario.padEnd(32)} ${foundStr.padEnd(12)} ${correctStr.padEnd(22)} ${wrongStr.padEnd(22)} ${missingStr.padEnd(22)} ${charPct.padEnd(7)} ${confPct}`);
  }

  console.log(`\n  ────────────────────────────────────────────────────────────────────────────────────────`);
  console.log(`  PASS: ${passCount}/${allResults.length} scenarios (all words correct, no garbage)`);

  // Summary by category
  console.log('\n\n' + '='.repeat(100));
  console.log('  BREAKDOWN BY CATEGORY');
  console.log('='.repeat(100));

  const categories: [string, number[]][] = [
    ['Baseline (white bg/black text)', [0]],
    ['Colored backgrounds', [1, 2, 3, 4]],
    ['Colored / light text', [5, 6, 7]],
    ['Drop shadows', [8, 9]],
    ['Borders / strokes', [10, 11]],
    ['Low contrast', [12, 13]],
    ['Different fonts (serif, bold, italic)', [14, 15, 16]],
    ['Small / tiny text', [17, 18]],
    ['Noisy background', [19, 20]],
    ['JPEG artifacts', [21]],
    ['Inverted / terminal colors', [22, 23]],
    ['Underlined text', [24]],
    ['Case sensitivity (ALL CAPS, lowercase)', [25, 26]],
  ];

  for (const [catName, indices] of categories) {
    const catResults = indices.map(i => allResults[i]);
    const catPass = catResults.filter(r => r.missingWords.length === 0 && r.wrongWords.length === 0).length;
    const avgChar = catResults.reduce((s, r) => s + r.characterAccuracy, 0) / catResults.length;
    const avgWordAcc = catResults.reduce((s, r) => {
      const correct = r.correctWords.length;
      const total = r.wordsExpected;
      return s + (total > 0 ? correct / total : 0);
    }, 0) / catResults.length;
    console.log(`  ${catName.padEnd(36)} ${catPass}/${catResults.length} pass  |  word acc: ${(avgWordAcc*100).toFixed(1)}%  |  char acc: ${(avgChar*100).toFixed(1)}%`);
  }

  // Worst performers
  console.log('\n\n' + '='.repeat(100));
  console.log('  WORST PERFORMERS (char accuracy < 50%)');
  console.log('='.repeat(100));
  const sorted = [...allResults].sort((a, b) => a.characterAccuracy - b.characterAccuracy);
  const worst = sorted.filter(r => r.characterAccuracy < 0.5);
  if (worst.length === 0) {
    console.log('  (none — all above 50% character accuracy)');
  } else {
    for (const r of worst) {
      const charPct = (r.characterAccuracy * 100).toFixed(1);
      console.log(`  ✗ ${r.scenario}: char_acc=${charPct}%  output="${r.tessOutput.slice(0, 60)}"`);
    }
  }

  // Save full results as JSON
  const jsonPath = path.join(outputDir, 'stress-test-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
  console.log(`\n\n  Full results saved to: ${jsonPath}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
