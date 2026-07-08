import 'dotenv/config';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

// Also load .env from ~/.pdf-editor/ (for the distributed .app bundle)
const homeEnvPath = path.join(require('os').homedir(), '.pdf-editor', '.env');
if (fs.existsSync(homeEnvPath)) {
  dotenv.config({ path: homeEnvPath });
}
import { pdfRouter } from './routes/pdf';
import { aiRouter } from './routes/ai';
import { skillRouter } from './routes/skill';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '100mb' }));

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const FONTS_DIR = path.join(__dirname, '..', '..', 'backend', 'fonts');
if (fs.existsSync(FONTS_DIR)) {
  app.use('/api/fonts', express.static(FONTS_DIR));
}

const FONT_CATEGORIES: Record<string, string> = {
  Abel: 'sans-serif', Alegreya: 'serif', Archivo: 'sans-serif', Arvo: 'slab-serif',
  Asap: 'sans-serif', Assistant: 'sans-serif', BarlowCondensed: 'sans-serif',
  BeVietnamPro: 'sans-serif', BenchNine: 'sans-serif', Bitter: 'serif',
  Cabin: 'sans-serif', Cantarell: 'sans-serif', Cardo: 'serif',
  CrimsonPro: 'serif', CutiveMono: 'mono', DMMono: 'mono', DMSans: 'sans-serif',
  Domine: 'serif', Dosis: 'sans-serif', EBGaramond: 'serif', Epilogue: 'sans-serif',
  Faustina: 'serif', FiraCode: 'mono', FiraSans: 'sans-serif', Heebo: 'sans-serif',
  Hind: 'sans-serif', HindSiliguri: 'sans-serif', IBMPlexMono: 'mono',
  IBMPlexSans: 'sans-serif', Inconsolata: 'mono', Inter: 'sans-serif',
  IstokWeb: 'sans-serif', JetBrainsMono: 'mono', Karla: 'sans-serif',
  Lato: 'sans-serif', LibreBaskerville: 'serif', Lora: 'serif',
  MavenPro: 'sans-serif', Merriweather: 'serif', Montserrat: 'sans-serif',
  Mukta: 'sans-serif', NewsCycle: 'sans-serif', NotoSans: 'sans-serif',
  NotoSansDisplay: 'sans-serif', NotoSerif: 'serif', Nunito: 'sans-serif',
  OpenSans: 'sans-serif', Oswald: 'sans-serif', Overpass: 'sans-serif',
  PathwayGothicOne: 'sans-serif', PlayfairDisplay: 'serif', Poppins: 'sans-serif',
  PublicSans: 'sans-serif', Raleway: 'sans-serif', Roboto: 'sans-serif',
  RobotoMono: 'mono', RobotoSlab: 'slab-serif', Rubik: 'sans-serif',
  Sora: 'sans-serif', SourceCodePro: 'mono', SourceSans3: 'sans-serif',
  SourceSerif4: 'serif', SpaceMono: 'mono', Taviraj: 'serif', Tinos: 'serif',
  TitilliumWeb: 'sans-serif', Vollkorn: 'serif', WorkSans: 'sans-serif',
  ZillaSlab: 'slab-serif',
  Helvetica: 'sans-serif', 'Helvetica Neue': 'sans-serif', Arial: 'sans-serif',
  Verdana: 'sans-serif', 'Trebuchet MS': 'sans-serif', 'Gill Sans': 'sans-serif',
  Futura: 'sans-serif', Avenir: 'sans-serif', 'Lucida Grande': 'sans-serif', Geneva: 'sans-serif',
  'Times New Roman': 'serif', Palatino: 'serif', Georgia: 'serif', Optima: 'serif',
  'Courier New': 'mono', Menlo: 'mono', Monaco: 'mono',
};

app.get('/api/fonts/manifest', (_req, res) => {
  const manifest: Record<string, { file: string | null; category: string }> = {};
  for (const [family, cat] of Object.entries(FONT_CATEGORIES)) {
    if (!manifest[family]) manifest[family] = { file: null, category: cat };
  }
  if (fs.existsSync(FONTS_DIR)) {
    for (const f of fs.readdirSync(FONTS_DIR).filter(f => f.endsWith('.ttf'))) {
      const family = f.split('-')[0];
      const cat = FONT_CATEGORIES[family] || 'sans-serif';
      if (!manifest[family] || manifest[family].file === null) {
        manifest[family] = { file: f, category: cat };
      }
    }
  }
  res.json(manifest);
});

app.use('/api/pdf', pdfRouter);
app.use('/api/ai', aiRouter);
app.use('/api/skill', skillRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/api/shutdown', (_req, res) => {
  res.json({ status: 'shutting_down' });
  setTimeout(() => process.exit(0), 100);
});

// Serve built frontend for local/daemon usage
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
