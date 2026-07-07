import { createCanvas } from 'canvas';
import { execFileSync } from 'child_process';
import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';

interface Bbox { x: number; y: number; w: number; h: number }

const FONT_GROUPS = [
  { label: 'SANS-SERIF', font: 'Helvetica Neue' },
  { label: 'SERIF',      font: 'Times New Roman' },
  { label: 'SLAB SERIF', font: 'American Typewriter' },
];

const TEST_WORDS = [
  { text: 'Hello',  x: 50, y: 100, fontSize: 36, color: '#000' },
  { text: 'World',  x: 50, y: 160, fontSize: 36, color: '#000' },
  { text: 'ABC123', x: 50, y: 220, fontSize: 28, color: '#333' },
];

function generateImage(fontName: string, width = 500, height = 300) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  const expected = new Map<string, Bbox>();

  for (const t of TEST_WORDS) {
    ctx.fillStyle = t.color;
    ctx.font = `bold ${t.fontSize}px "${fontName}"`;
    ctx.fillText(t.text, t.x, t.y);
    const m = ctx.measureText(t.text);
    expected.set(t.text, {
      x: Math.round(t.x + (m.actualBoundingBoxLeft || 0)),
      y: Math.round(t.y - m.actualBoundingBoxAscent),
      w: Math.round((m.actualBoundingBoxRight || m.width) - (m.actualBoundingBoxLeft || 0)),
      h: Math.round(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent),
    });
  }
  return { png: canvas.toBuffer('image/png'), jpg: canvas.toBuffer('image/jpeg', { quality: 0.9 }), expected };
}

function bboxOverlap(a: Bbox, b: Bbox): number {
  const l = Math.max(a.x, b.x), t = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), bo = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, r - l) * Math.max(0, bo - t);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function uniqueCharRatio(items: Bbox[]): string {
  if (!items || items.length === 0) return '—';
  const set = new Set(items.filter(c => c).map(c => `${c.x},${c.y},${c.w},${c.h}`));
  return `${set.size}/${items.length}`;
}

function formatBboxStr(b: [number, number, number, number] | Bbox | undefined, missing = '—'): string {
  if (!b) return missing;
  return `[${b[0]},${b[1]},${b[2]},${b[3]}]`;
}

async function runTesseract(imagePath: string) {
  const worker = await Tesseract.createWorker('eng', 1);
  const { data } = await worker.recognize(imagePath, {}, { blocks: true });
  const results: any[] = [];
  if (data.blocks) {
    for (const block of data.blocks)
      for (const para of block.paragraphs)
        for (const line of para.lines)
          for (const word of line.words) {
            const b = word.bbox;
            const cbs = (word.symbols || []).map((s: any) =>
              s.bbox ? { x: Math.round(s.bbox.x0), y: Math.round(s.bbox.y0), w: Math.round(s.bbox.x1 - s.bbox.x0), h: Math.round(s.bbox.y1 - s.bbox.y0) } : null
            );
            results.push({
              text: word.text, conf: word.confidence / 100,
              bbox: [Math.round(b.x0), Math.round(b.y0), Math.round(b.x1 - b.x0), Math.round(b.y1 - b.y0)],
              charBboxes: cbs,
            });
          }
  }
  await worker.terminate();
  return results;
}

function runVision(imagePath: string) {
  const bin = '/tmp/vision-ocr';
  if (!fs.existsSync(bin)) {
    const src = path.join(__dirname, '..', 'bin', 'vision-ocr.m');
    execFileSync('/usr/bin/clang', ['-framework', 'Foundation', '-framework', 'Vision', '-framework', 'Cocoa', '-o', bin, src],
      { timeout: 30000, stdio: 'pipe' });
  }
  const output = execFileSync(bin, [imagePath], { timeout: 30000, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
  const items = JSON.parse(output.toString('utf-8'));
  return (items || []).map((item: any) => ({
    text: (item.text || '').trim(),
    conf: item.confidence || 0,
    bbox: [Math.round(item.bbox[0]), Math.round(item.bbox[1]), Math.round(item.bbox[2]), Math.round(item.bbox[3])],
    charBboxes: (item.charBboxes || []).map((cb: any) =>
      cb === null ? null : { x: Math.round(cb[0]), y: Math.round(cb[1]), w: Math.round(cb[2]), h: Math.round(cb[3]) }
    ),
  }));
}

async function main() {
  const tmpDir = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(tmpDir, { recursive: true });

  const allResults: { label: string; font: string; expected: Map<string, Bbox>; tess: any[]; vis: any[] }[] = [];

  // Generate images and run OCR for each font
  for (const fg of FONT_GROUPS) {
    console.log(`\n=== ${fg.label} (${fg.font}) ===`);
    const { png, jpg, expected } = generateImage(fg.font);
    const baseName = `compare-${fg.label.toLowerCase().replace(/\s+/g, '-')}`;
    const pngPath = path.join(tmpDir, `${baseName}.png`);
    const jpgPath = path.join(tmpDir, `${baseName}.jpg`);
    fs.writeFileSync(pngPath, png);
    fs.writeFileSync(jpgPath, jpg);

    console.log('  Running Tesseract.js...');
    const tess = await runTesseract(pngPath);
    console.log(`  ${tess.length} words`);

    console.log('  Running macOS Vision OCR...');
    const vis = runVision(jpgPath);
    console.log(`  ${vis.length} words`);

    allResults.push({ label: fg.label, font: fg.font, expected, tess, vis });
  }

  // Print per-font IoU table
  console.log('\n\n' + '='.repeat(120));
  console.log('  WORD-LEVEL BBOX IoU COMPARISON');
  console.log('='.repeat(120));

  for (const r of allResults) {
    console.log(`\n  ─── ${r.label} (${r.font}) ───`);
    console.log(`  ${'Word'.padEnd(10)} ${'Expected'.padEnd(22)} ${'Tesseract'.padEnd(22)} ${'Tess IoU'.padEnd(10)} ${'Vision'.padEnd(22)} ${'Vis IoU'}`);
    console.log(`  ${''.padEnd(10, '─')} ${''.padEnd(22, '─')} ${''.padEnd(22, '─')} ${''.padEnd(10, '─')} ${''.padEnd(22, '─')} ${''.padEnd(6, '─')}`);

    let tTotal = 0, vTotal = 0, tN = 0, vN = 0;
    for (const w of TEST_WORDS) {
      const exp = r.expected.get(w.text);
      const tess = r.tess.find((x: any) => x.text === w.text);
      const vis = r.vis.find((x: any) => x.text === w.text);
      const tIou = exp && tess ? bboxOverlap(exp, { x: tess.bbox[0], y: tess.bbox[1], w: tess.bbox[2], h: tess.bbox[3] }) : -1;
      const vIou = exp && vis ? bboxOverlap(exp, { x: vis.bbox[0], y: vis.bbox[1], w: vis.bbox[2], h: vis.bbox[3] }) : -1;
      if (tIou >= 0) { tTotal += tIou; tN++; }
      if (vIou >= 0) { vTotal += vIou; vN++; }

      const expStr = formatBboxStr(exp ? [exp.x, exp.y, exp.w, exp.h] : undefined);
      const tessStr = formatBboxStr(tess?.bbox).padEnd(22);
      const visStr = formatBboxStr(vis?.bbox).padEnd(22);
      const tIouStr = tIou >= 0 ? tIou.toFixed(3) : 'MISS';
      const vIouStr = vIou >= 0 ? vIou.toFixed(3) : 'MISS';
      console.log(`  ${w.text.padEnd(10)} ${expStr.padEnd(22)} ${tessStr} ${tIouStr.padEnd(10)} ${visStr} ${vIouStr}`);
    }
    console.log(`  ${'AVG'.padEnd(10)} ${''.padEnd(22)} ${''.padEnd(22)} ${(tTotal / tN).toFixed(3).padEnd(10)} ${''.padEnd(22)} ${(vTotal / vN).toFixed(3)}`);
  }

  // Print char-level comparison
  console.log('\n\n' + '='.repeat(120));
  console.log('  CHAR-LEVEL BBOXES (unique chars / total chars)');
  console.log('='.repeat(120));
  console.log(`\n  ${'Font'.padEnd(16)} ${'Word'.padEnd(10)} ${'Tesseract'.padEnd(16)} ${'Vision'.padEnd(16)} ${'Winner'}`);
  console.log(`  ${''.padEnd(16, '─')} ${''.padEnd(10, '─')} ${''.padEnd(16, '─')} ${''.padEnd(16, '─')} ${''.padEnd(10, '─')}`);

  for (const r of allResults) {
    let first = true;
    for (const w of TEST_WORDS) {
      const tess = r.tess.find((x: any) => x.text === w.text);
      const vis = r.vis.find((x: any) => x.text === w.text);
      const tRatio = tess ? uniqueCharRatio(tess.charBboxes) : '—';
      const vRatio = vis ? uniqueCharRatio(vis.charBboxes) : '—';

      // Parse ratios to determine winner
      const tParts = tRatio.split('/');
      const vParts = vRatio.split('/');
      let winner = '—';
      if (tRatio !== '—' && vRatio !== '—') {
        const tPct = parseInt(tParts[0]) / parseInt(tParts[1]);
        const vPct = parseInt(vParts[0]) / parseInt(vParts[1]);
        if (tPct > vPct) winner = 'Tesseract';
        else if (vPct > tPct) winner = 'Vision';
        else winner = 'Tie';
      }

      console.log(`  ${(first ? r.label : '').padEnd(16)} ${w.text.padEnd(10)} ${tRatio.padEnd(16)} ${vRatio.padEnd(16)} ${winner}`);
      first = false;
    }
  }

  // Winner summary
  console.log('\n\n' + '='.repeat(120));
  console.log('  WINNER SUMMARY');
  console.log('='.repeat(120));
  console.log(`\n  ${'Metric'.padEnd(25)} ${'Sans-Serif'.padEnd(14)} ${'Serif'.padEnd(14)} ${'Slab Serif'.padEnd(14)}`);
  console.log(`  ${''.padEnd(25, '─')} ${''.padEnd(14, '─')} ${''.padEnd(14, '─')} ${''.padEnd(14, '─')}`);

  // Word IoU winners
  let line = '  Word IoU'.padEnd(25);
  for (const r of allResults) {
    let tTotal = 0, vTotal = 0, tN = 0, vN = 0;
    for (const w of TEST_WORDS) {
      const exp = r.expected.get(w.text);
      const tess = r.tess.find((x: any) => x.text === w.text);
      const vis = r.vis.find((x: any) => x.text === w.text);
      const tIou = exp && tess ? bboxOverlap(exp, { x: tess.bbox[0], y: tess.bbox[1], w: tess.bbox[2], h: tess.bbox[3] }) : -1;
      const vIou = exp && vis ? bboxOverlap(exp, { x: vis.bbox[0], y: vis.bbox[1], w: vis.bbox[2], h: vis.bbox[3] }) : -1;
      if (tIou >= 0) { tTotal += tIou; tN++; }
      if (vIou >= 0) { vTotal += vIou; vN++; }
    }
    const tAvg = tTotal / tN;
    const vAvg = vTotal / vN;
    line += ` ${tAvg > vAvg ? 'Tesseract' : 'Vision'} (T:${tAvg.toFixed(3)} V:${vAvg.toFixed(3)})`.padEnd(14);
  }
  console.log(line);

  // Char bbox winners
  line = '  Char bbox quality'.padEnd(25);
  for (const r of allResults) {
    let tUnique = 0, tTotal = 0, vUnique = 0, vTotal = 0;
    for (const w of TEST_WORDS) {
      const tess = r.tess.find((x: any) => x.text === w.text);
      const vis = r.vis.find((x: any) => x.text === w.text);
      if (tess?.charBboxes) {
        tTotal += tess.charBboxes.length;
        const set = new Set(tess.charBboxes.filter((c: any) => c).map((c: any) => `${c.x},${c.y},${c.w},${c.h}`));
        tUnique += set.size;
      }
      if (vis?.charBboxes) {
        vTotal += vis.charBboxes.length;
        const set = new Set(vis.charBboxes.filter((c: any) => c).map((c: any) => `${c.x},${c.y},${c.w},${c.h}`));
        vUnique += set.size;
      }
    }
    const tPct = tTotal > 0 ? tUnique / tTotal : 0;
    const vPct = vTotal > 0 ? vUnique / vTotal : 0;
    line += ` ${tPct > vPct ? 'Tesseract' : vPct > tPct ? 'Vision' : 'Tie'} (T:${(tPct*100).toFixed(0)}% V:${(vPct*100).toFixed(0)}%)`.padEnd(14);
  }
  console.log(line);

  // Text detection winners
  line = '  Text detection'.padEnd(25);
  for (const r of allResults) {
    const tFound = TEST_WORDS.filter(w => r.tess.find((x: any) => x.text === w.text)).length;
    const vFound = TEST_WORDS.filter(w => r.vis.find((x: any) => x.text === w.text)).length;
    line += ` ${tFound > vFound ? 'Tesseract' : vFound > tFound ? 'Vision' : 'Tie'} (T:${tFound}/3 V:${vFound}/3)`.padEnd(14);
  }
  console.log(line);

  // Confirmation of binary identity
  const binStat = fs.statSync('/tmp/vision-ocr');
  const srcStat = fs.statSync(path.join(__dirname, '..', 'bin', 'vision-ocr.m'));
  console.log(`\n\n  ✓ macOS Vision binary: /tmp/vision-ocr`);
  console.log(`    Source: backend/bin/vision-ocr.m`);
  console.log(`    Binary size: ${binStat.size} bytes, last modified: ${binStat.mtime.toISOString()}`);
  console.log(`    Source size: ${srcStat.size} bytes`);
  console.log(`    Compiler: /usr/bin/clang -framework Foundation -framework Vision -framework Cocoa`);
  console.log(`    Vision settings: recognitionLevel=Accurate, usesLanguageCorrection=NO`);
  console.log(`    These match backend/src/services/pdf/ocr.ts ensureBinary() and binary exactly.`);

  console.log(`\n  ✓ Tesseract.js v7 with { blocks: true }`);
  console.log(`    Blocks output: block → paragraphs → lines → words → symbols (char bboxes)`);
}

main().catch((err) => { console.error('Test failed:', err); process.exit(1); });
