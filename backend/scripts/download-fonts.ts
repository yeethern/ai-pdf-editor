import fs from 'fs';
import path from 'path';
import https from 'https';

interface FontEntry {
  family: string;
  dir: string;
  license: 'ofl' | 'apache' | 'ubuntu';
}

const FONTS: FontEntry[] = [
  { family: 'Roboto', dir: 'roboto', license: 'ofl' },
  { family: 'Open Sans', dir: 'opensans', license: 'ofl' },
  { family: 'Lato', dir: 'lato', license: 'ofl' },
  { family: 'Montserrat', dir: 'montserrat', license: 'ofl' },
  { family: 'Source Sans 3', dir: 'sourcesans3', license: 'ofl' },
  { family: 'Noto Sans', dir: 'notosans', license: 'ofl' },
  { family: 'Inter', dir: 'inter', license: 'ofl' },
  { family: 'Nunito', dir: 'nunito', license: 'ofl' },
  { family: 'Poppins', dir: 'poppins', license: 'ofl' },
  { family: 'Work Sans', dir: 'worksans', license: 'ofl' },
  { family: 'Rubik', dir: 'rubik', license: 'ofl' },
  { family: 'Oswald', dir: 'oswald', license: 'ofl' },
  { family: 'Raleway', dir: 'raleway', license: 'ofl' },
  { family: 'Ubuntu', dir: 'ubuntu', license: 'ubuntu' },
  { family: 'PT Sans', dir: 'ptsans', license: 'ofl' },
  { family: 'Fira Sans', dir: 'firasans', license: 'ofl' },
  { family: 'Dosis', dir: 'dosis', license: 'ofl' },
  { family: 'DM Sans', dir: 'dmsans', license: 'ofl' },
  { family: 'Asap', dir: 'asap', license: 'ofl' },
  { family: 'Titillium Web', dir: 'titilliumweb', license: 'ofl' },
  { family: 'Cabin', dir: 'cabin', license: 'ofl' },
  { family: 'Hind', dir: 'hind', license: 'ofl' },
  { family: 'Mukta', dir: 'mukta', license: 'ofl' },
  { family: 'Karla', dir: 'karla', license: 'ofl' },
  { family: 'Assistant', dir: 'assistant', license: 'ofl' },
  { family: 'Heebo', dir: 'heebo', license: 'ofl' },
  { family: 'Abel', dir: 'abel', license: 'ofl' },
  { family: 'Archivo', dir: 'archivo', license: 'ofl' },
  { family: 'Public Sans', dir: 'publicsans', license: 'ofl' },
  { family: 'Maven Pro', dir: 'mavenpro', license: 'ofl' },
  { family: 'Overpass', dir: 'overpass', license: 'ofl' },
  { family: 'Sora', dir: 'sora', license: 'ofl' },
  { family: 'Epilogue', dir: 'epilogue', license: 'ofl' },
  { family: 'Be Vietnam Pro', dir: 'bevietnampro', license: 'ofl' },
  { family: 'Noto Sans Display', dir: 'notosansdisplay', license: 'ofl' },
  { family: 'Cardo', dir: 'cardo', license: 'ofl' },
  { family: 'Zilla Slab', dir: 'zillaslab', license: 'ofl' },
  { family: 'Taviraj', dir: 'taviraj', license: 'ofl' },
  { family: 'Arvo', dir: 'arvo', license: 'ofl' },
  { family: 'Space Mono', dir: 'spacemono', license: 'ofl' },
  { family: 'IBM Plex Mono', dir: 'ibmplexmono', license: 'ofl' },
  { family: 'Barlow Condensed', dir: 'barlowcondensed', license: 'ofl' },
  { family: 'News Cycle', dir: 'newscycle', license: 'ofl' },
  { family: 'Pathway Gothic One', dir: 'pathwaygothicone', license: 'ofl' },
  { family: 'Cantarell', dir: 'cantarell', license: 'ofl' },
  { family: 'Istok Web', dir: 'istokweb', license: 'ofl' },
  { family: 'BenchNine', dir: 'benchnine', license: 'ofl' },
  { family: 'Hind Siliguri', dir: 'hindsiliguri', license: 'ofl' },
  { family: 'IBM Plex Sans', dir: 'ibmplexsans', license: 'ofl' },
  // --- Serif ---
  { family: 'Noto Serif', dir: 'notoserif', license: 'ofl' },
  { family: 'Roboto Slab', dir: 'robotoslab', license: 'apache' },
  { family: 'Merriweather', dir: 'merriweather', license: 'ofl' },
  { family: 'Playfair Display', dir: 'playfairdisplay', license: 'ofl' },
  { family: 'Source Serif 4', dir: 'sourceserif4', license: 'ofl' },
  { family: 'Lora', dir: 'lora', license: 'ofl' },
  { family: 'PT Serif', dir: 'ptserif', license: 'ofl' },
  { family: 'Crimson Pro', dir: 'crimsonpro', license: 'ofl' },
  { family: 'Libre Baskerville', dir: 'librebaskerville', license: 'ofl' },
  { family: 'Alegreya', dir: 'alegreya', license: 'ofl' },
  { family: 'EB Garamond', dir: 'ebgaramond', license: 'ofl' },
  { family: 'Tinos', dir: 'tinos', license: 'apache' },
  { family: 'Bitter', dir: 'bitter', license: 'ofl' },
  { family: 'Domine', dir: 'domine', license: 'ofl' },
  { family: 'Vollkorn', dir: 'vollkorn', license: 'ofl' },
  { family: 'Faustina', dir: 'faustina', license: 'ofl' },
  // --- Monospace ---
  { family: 'Roboto Mono', dir: 'robotomono', license: 'apache' },
  { family: 'Source Code Pro', dir: 'sourcecodepro', license: 'ofl' },
  { family: 'Fira Code', dir: 'firacode', license: 'ofl' },
  { family: 'JetBrains Mono', dir: 'jetbrainsmono', license: 'ofl' },
  { family: 'Inconsolata', dir: 'inconsolata', license: 'ofl' },
  { family: 'DM Mono', dir: 'dmmono', license: 'ofl' },
  { family: 'Cutive Mono', dir: 'cutivemono', license: 'ofl' },
];

/** Try to download a font file, trying multiple URL patterns and license directories. */
async function tryDownload(family: string, dir: string, license: string, destBase: string): Promise<string[]> {
  const sanitized = family.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
  const licenses = ['ofl', 'apache', 'ubuntu'];
  const usedLicenses = [...new Set([license, ...licenses])];

  const candidates = [
    `${sanitized}-Regular.ttf`,
    `${sanitized}[wdth,wght].ttf`,
    `${sanitized}[opsz,wght].ttf`,
    `${sanitized}[opsz,wdth,wght].ttf`,
    `${sanitized}[wght].ttf`,
  ];

  for (const lic of usedLicenses) {
    const baseUrl = `https://github.com/google/fonts/raw/main/${lic}/${dir}/`;
    for (const filename of candidates) {
      const url = baseUrl + filename;
      const dest = destBase + '.ttf';
      try {
        await downloadFile(url, dest);
        const size = fs.statSync(dest).size;
        if (size < 1000) { fs.unlinkSync(dest); throw new Error('too small'); }

        // Also try Bold static
        const boldUrl = baseUrl + `${sanitized}-Bold.ttf`;
        const boldDest = destBase + '-Bold.ttf';
        try {
          await downloadFile(boldUrl, boldDest);
          const boldSize = fs.statSync(boldDest).size;
          if (boldSize < 1000) fs.unlinkSync(boldDest);
        } catch {
          // Bold not available separately
        }

        return [filename, 'OK'];
      } catch {
        continue;
      }
    }
  }

  throw new Error('all candidates failed');
}

async function downloadFile(rawUrl: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = rawUrl.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        downloadFile(res.headers.location!.replace(/\[/g, '%5B').replace(/\]/g, '%5D'), dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });
    req.on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function withPool<T>(tasks: (() => Promise<T>)[], pool: number): Promise<T[]> {
  const results: T[] = [];
  const running = new Set<Promise<void>>();
  for (let i = 0; i < tasks.length; i++) {
    const p = tasks[i]().then(r => { results[i] = r; });
    running.add(p.then(() => running.delete(p)));
    if (running.size >= pool) await Promise.race(running);
  }
  await Promise.all([...running]);
  return results;
}

async function main() {
  const fontsDir = path.join(__dirname, '..', 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });

  const tasks: (() => Promise<string>)[] = [];

  for (const entry of FONTS) {
    const san = entry.family.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    const destRegular = path.join(fontsDir, `${san}-Regular`);
    const destBold = path.join(fontsDir, `${san}-Bold`);

    // Check if already downloaded (either regular or var)
    const already =
      fs.existsSync(destRegular + '.ttf') ||
      fs.existsSync(destRegular + '-var.ttf');
    if (already) continue;

    tasks.push(async () => {
      try {
        const results = await tryDownload(entry.family, entry.dir, entry.license, destRegular);

        const size = fs.statSync(destRegular + '.ttf').size;
        const boldExists = fs.existsSync(destBold + '.ttf');
        return `OK  ${san} ${(size / 1024).toFixed(0)}KB${boldExists ? ' +Bold' : ''}`;

      } catch (err: any) {
        return `SKIP ${entry.family} — ${err.message}`;
      }
    });
  }

  if (tasks.length === 0) {
    console.log('All fonts already downloaded.');
    return;
  }

  console.log(`Downloading ${tasks.length} fonts (concurrency 8)...\n`);

  const lines = await withPool(tasks, 8);
  lines.forEach(l => console.log(`  ${l}`));

  const ok = lines.filter(l => l.startsWith('OK')).length;
  const skip = lines.filter(l => l.startsWith('SKIP')).length;
  const totalMB = (fs.readdirSync(fontsDir)
    .filter(f => f.endsWith('.ttf'))
    .reduce((s, f) => s + fs.statSync(path.join(fontsDir, f)).size, 0) / (1024 * 1024));

  console.log(`\nDone: ${ok} downloaded, ${skip} not found, ${totalMB.toFixed(1)} MB total`);
}

main().catch(console.error);
