import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { DetectedQRCode } from '../../types';
import { v4 as uuid } from 'uuid';

const BIN_PATH = path.join(__dirname, '..', '..', '..', 'bin', 'vision-qr.m');
const COMPILED_PATH = '/tmp/vision-qr';

function isMacOS(): boolean {
  return process.platform === 'darwin' && fs.existsSync('/usr/bin/clang');
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

export async function detectQRCode(
  imageBuffer: Buffer,
  renderScale: number,
  pageNum: number,
): Promise<DetectedQRCode[]> {
  if (!isMacOS()) {
    console.warn('QR detection requires macOS');
    return [];
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-'));
  const imgPath = path.join(tmpDir, 'page.jpg');

  try {
    fs.writeFileSync(imgPath, imageBuffer);
    const binary = ensureBinary();

    if (!fs.existsSync(binary)) {
      console.error('QR binary not found');
      return [];
    }

    const output = execFileSync(binary, [imgPath], {
      timeout: 30000,
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024,
    });

    const items = JSON.parse(output.toString('utf-8'));
    if (!Array.isArray(items)) return [];

    return items.map((item: any) => {
      const rawBbox: [number, number, number, number] = item.boundingBox;
      const bbox: [number, number, number, number] = [
        Math.round(rawBbox[0] / renderScale),
        Math.round(rawBbox[1] / renderScale),
        Math.round(rawBbox[2] / renderScale),
        Math.round(rawBbox[3] / renderScale),
      ];

      const corners: [number, number][] | undefined = item.corners?.length === 4
        ? item.corners.map((c: [number, number]) => [
            Math.round(c[0] / renderScale),
            Math.round(c[1] / renderScale),
          ] as [number, number])
        : undefined;

      return {
        id: uuid(),
        page: pageNum,
        content: item.content || '',
        bbox,
        corners,
      };
    });
  } catch (e) {
    console.error('QR detection failed:', e);
    return [];
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
  }
}