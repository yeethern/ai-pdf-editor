import { createCanvas } from 'canvas';
import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';

interface TestWord {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TEST_WORDS: TestWord[] = [
  { text: 'Hello',   x: 50, y: 100, fontSize: 36, color: '#000' },
  { text: 'World',   x: 50, y: 160, fontSize: 36, color: '#000' },
  { text: 'ABC123',  x: 50, y: 220, fontSize: 28, color: '#333' },
];

function generateTestImage(width = 500, height = 300): { buffer: Buffer; expectedBboxes: Map<string, Bbox> } {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  const expected = new Map<string, Bbox>();

  for (const t of TEST_WORDS) {
    ctx.fillStyle = t.color;
    ctx.font = `${t.fontSize}px serif`;
    ctx.fillText(t.text, t.x, t.y);

    const metrics = ctx.measureText(t.text);
    const top = t.y - metrics.actualBoundingBoxAscent;
    const bottom = t.y + metrics.actualBoundingBoxDescent;
    const left = t.x + (metrics.actualBoundingBoxLeft || 0);
    const right = t.x + (metrics.actualBoundingBoxRight || metrics.width);

    expected.set(t.text, {
      x: Math.round(left),
      y: Math.round(top),
      w: Math.round(right - left),
      h: Math.round(bottom - top),
    });
  }

  return { buffer: canvas.toBuffer('image/png'), expectedBboxes: expected };
}

function makeOcrItem(text: string, left: number, top: number, width: number, height: number, conf: number, charBboxes: (Bbox | null)[] = []) {
  return {
    id: uuid(),
    type: 'text' as const,
    content: text,
    bbox: [left, top, width, height],
    confidence: conf,
    fontSize: height,
    editable: true,
    style: { bold: false, italic: false, underline: false },
    charBboxes,
  };
}

function bboxOverlap(a: Bbox, b: Bbox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function printComparison(expected: Map<string, Bbox>, results: any[]) {
  console.log('\n' + '='.repeat(80));
  console.log('  WORD-LEVEL BBOX COMPARISON');
  console.log('='.repeat(80));
  console.log(`  ${'Text'.padEnd(12)} ${'Expected'.padEnd(28)} ${'Tesseract'.padEnd(28)} ${'IoU'.padEnd(8)}`);
  console.log('  ' + '-'.repeat(76));

  let totalIou = 0;
  let matchCount = 0;

  for (const word of TEST_WORDS) {
    const exp = expected.get(word.text);
    const found = results.find((r: any) => r.content === word.text);

    if (exp && found) {
      const fBbox: Bbox = { x: found.bbox[0], y: found.bbox[1], w: found.bbox[2], h: found.bbox[3] };
      const iou = bboxOverlap(exp, fBbox);
      totalIou += iou;
      matchCount++;

      const expStr = `[${String(exp.x).padStart(4)}, ${String(exp.y).padStart(4)}, ${String(exp.w).padStart(4)}, ${String(exp.h).padStart(4)}]`;
      const tessStr = `[${String(fBbox.x).padStart(4)}, ${String(fBbox.y).padStart(4)}, ${String(fBbox.w).padStart(4)}, ${String(fBbox.h).padStart(4)}]`;
      console.log(`  ${word.text.padEnd(12)} ${expStr.padEnd(28)} ${tessStr.padEnd(28)} ${iou.toFixed(3)}`);
    } else if (exp) {
      console.log(`  ${word.text.padEnd(12)} ${`[${exp.x}, ${exp.y}, ${exp.w}, ${exp.h}]`.padEnd(28)} ${'NOT FOUND'.padEnd(28)}`);
    }
  }

  console.log(`\n  Average IoU: ${(totalIou / Math.max(1, matchCount)).toFixed(3)}`);
  console.log(`  Words matched: ${matchCount}/${TEST_WORDS.length}`);

  // Char bboxes for first word
  const firstResult = results.find((r: any) => r.content === TEST_WORDS[0].text);
  if (firstResult && firstResult.charBboxes && firstResult.charBboxes.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log(`  CHAR-LEVEL BBOXES for "${TEST_WORDS[0].text}"`);
    console.log('='.repeat(80));
    console.log(`  ${'Char'.padEnd(8)} ${'Bbox'.padEnd(28)}`);
    console.log('  ' + '-'.repeat(36));
    for (let i = 0; i < firstResult.content.length; i++) {
      const cb = firstResult.charBboxes[i];
      if (cb) {
        const bboxStr = `[${String(cb.x).padStart(4)}, ${String(cb.y).padStart(4)}, ${String(cb.w).padStart(4)}, ${String(cb.h).padStart(4)}]`;
        console.log(`  ${firstResult.content[i].padEnd(8)} ${bboxStr.padEnd(28)}`);
      } else {
        console.log(`  ${firstResult.content[i].padEnd(8)} ${'null'.padEnd(28)}`);
      }
    }
  }

  // Full JSON output for inspection
  console.log('\n' + '='.repeat(80));
  console.log('  RAW TESSERACT OUTPUT (OcrWordItem format)');
  console.log('='.repeat(80));
  console.log(JSON.stringify(results, null, 2));
}

async function runOnImage(imagePath: string) {
  console.log(`\nRunning Tesseract.js on: ${imagePath}`);

  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m: any) => {
      if (m.status === 'recognizing text') {
        process.stdout.write(`\r  Progress: ${(m.progress * 100).toFixed(0)}%`);
      }
    },
  });

  const { data } = await worker.recognize(imagePath, {}, { blocks: true });
  console.log('\n');

  const results: any[] = [];

  if (data.blocks) {
    for (const block of data.blocks) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          for (const word of line.words) {
            const b = word.bbox;
            const charBboxes = (word.symbols || []).map((s: any) => {
              if (!s.bbox) return null;
              return { x: Math.round(s.bbox.x0), y: Math.round(s.bbox.y0), w: Math.round(s.bbox.x1 - s.bbox.x0), h: Math.round(s.bbox.y1 - s.bbox.y0) };
            });
            results.push(makeOcrItem(
              word.text,
              Math.round(b.x0), Math.round(b.y0),
              Math.round(b.x1 - b.x0), Math.round(b.y1 - b.y0),
              word.confidence / 100,
              charBboxes,
            ));
          }
        }
      }
    }
  }

  console.log(`Extracted ${results.length} words`);
  await worker.terminate();
  return results;
}

async function main() {
  const imageArg = process.argv[2];

  let results: any[];

  if (imageArg) {
    const imagePath = path.resolve(imageArg);
    if (!fs.existsSync(imagePath)) {
      console.error(`File not found: ${imagePath}`);
      process.exit(1);
    }
    results = await runOnImage(imagePath);
    console.log('\n' + '='.repeat(80));
    console.log('  TESSERACT OUTPUT (OcrWordItem format)');
    console.log('='.repeat(80));
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log('Generating test image...');
    const { buffer, expectedBboxes } = generateTestImage();

    const testImagePath = path.join(__dirname, '..', 'uploads', 'test-tesseract.png');
    fs.mkdirSync(path.dirname(testImagePath), { recursive: true });
    fs.writeFileSync(testImagePath, buffer);
    console.log(`Test image saved to: ${testImagePath}`);

    results = await runOnImage(testImagePath);

    console.log('\n' + '='.repeat(80));
    console.log('  EXPECTED BBOXES (from canvas measureText)');
    console.log('='.repeat(80));
    for (const word of TEST_WORDS) {
      const exp = expectedBboxes.get(word.text);
      if (exp) {
        console.log(`  ${word.text.padEnd(12)} [${exp.x}, ${exp.y}, ${exp.w}, ${exp.h}]  (font: ${word.fontSize}px serif, drawn at ${word.x},${word.y})`);
      }
    }

    printComparison(expectedBboxes, results);
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
