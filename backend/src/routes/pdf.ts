import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parsePDF, processPage, saveDocument, loadDocument, updateElement, getOriginalPath } from '../services/pdf/parser';
import { renderPage } from '../services/pdf/renderer';
import { bulkStyle } from '../services/pdf/bulkStyle';
import { exportPdf } from '../services/pdf/exportPdf';
import { PDFDocument, StyleRule, ImageOverlay } from '../types';
import { v4 as uuidv4 } from 'uuid';

const upload = multer({
  dest: path.join(__dirname, '..', '..', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files allowed'));
    }
  },
});

const imageUpload = multer({
  dest: path.join(__dirname, '..', '..', 'uploads', 'images'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'));
    }
  },
});

export const pdfRouter = Router();

pdfRouter.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');

    const writeLog = (type: string, message: string) => {
      res.write(JSON.stringify({ type, message }) + '\n');
    };

    const filePath = req.file.path;
    const { resetAccumulatedAiUsage, getAccumulatedAiUsage } = require('../services/ai/service');
    resetAccumulatedAiUsage();
    const document = await parsePDF(filePath, 2, writeLog);
    saveDocument(document);

    const pdfUrl = `/api/pdf/file/${document.id}`;
    const usage = getAccumulatedAiUsage();
    res.write(JSON.stringify({ type: 'done', data: { success: true, document, pdfUrl, usage } }) + '\n');
    res.end();
  } catch (err) {
    console.error('Upload failed:', err);
    const msg = err instanceof Error ? err.message : 'Failed to process PDF';
    res.write(JSON.stringify({ type: 'error', message: msg }) + '\n');
    res.end();
  }
});

pdfRouter.post('/:id/page/:pageNum/process', async (req: Request, res: Response) => {
  try {
    const doc = loadDocument(req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    const pageNum = parseInt(req.params.pageNum);
    if (isNaN(pageNum) || pageNum < 0 || pageNum >= doc.metadata!.pageCount) {
      res.status(400).json({ error: 'Invalid page number' });
      return;
    }

    const elements = await processPage(pageNum, doc);
    doc.pages[pageNum].elements = elements;
    saveDocument(doc);

    const { getLastAiUsage } = require('../services/ai/service');
    res.json({ success: true, elements, page: pageNum, usage: getLastAiUsage() });
  } catch (err) {
    console.error('Page process failed:', err);
    res.status(500).json({ error: 'Failed to process page' });
  }
});

pdfRouter.get('/:id', (req: Request, res: Response) => {
  const doc = loadDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  res.json({ document: doc });
});

pdfRouter.put('/:id/element', (req: Request, res: Response) => {
  const { pageIndex, elementId, updates } = req.body;
  const doc = loadDocument(req.params.id);

  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  const updated = updateElement(doc, pageIndex, elementId, updates);
  saveDocument(updated);
  res.json({ success: true, document: updated });
});

pdfRouter.put('/:id/pages/:pageIndex/elements/:elementId', (req: Request, res: Response) => {
  const doc = loadDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  const pageIndex = parseInt(req.params.pageIndex);
  const elementId = req.params.elementId;

  const updated = updateElement(doc, pageIndex, elementId, req.body);
  saveDocument(updated);
  res.json({ success: true, document: updated });
});

pdfRouter.get('/file/:id/page/:pageNum.png', async (req: Request, res: Response) => {
  try {
    const originalPath = getOriginalPath(req.params.id);
    if (!originalPath || !fs.existsSync(originalPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const pageNum = parseInt(req.params.pageNum);
    const scale = parseFloat(req.query.scale as string) || 2;
    const buffer = await renderPage(originalPath, pageNum, scale);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error('Page render failed:', err);
    res.status(500).json({ error: 'Failed to render page' });
  }
});

pdfRouter.get('/file/:id', (req: Request, res: Response) => {
  const originalPath = getOriginalPath(req.params.id);
  if (!originalPath || !fs.existsSync(originalPath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.sendFile(originalPath);
});

pdfRouter.post('/:id/save', (req: Request, res: Response) => {
  const doc = req.body.document as PDFDocument;
  saveDocument(doc);
  res.json({ success: true, document: doc });
});

pdfRouter.post('/:id/bulk-style', async (req: Request, res: Response) => {
  try {
    const { rules } = req.body as { rules: StyleRule[] };
    if (!rules || !Array.isArray(rules) || rules.length === 0) {
      res.status(400).json({ error: 'Rules array is required' });
      return;
    }
    const result = await bulkStyle(req.params.id, rules);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Bulk style failed:', err);
    res.status(500).json({ error: 'Bulk style operation failed' });
  }
 });

pdfRouter.post('/:id/bulk-find-replace', (req: Request, res: Response) => {
  const doc = loadDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
  const { find, replace } = req.body;
  if (!find) { res.status(400).json({ error: 'find string required' }); return; }
  let matched = 0;
  const matchedIds: string[] = [];
  for (const page of doc.pages) {
    for (const el of page.elements) {
      if (el.type !== 'text' || !el.content.includes(find)) continue;
      el.content = el.content.replaceAll(find, replace);
      matched++;
      matchedIds.push(el.id);
    }
  }
  saveDocument(doc);
  res.json({ success: true, document: doc, matched, matchedIds });
});

pdfRouter.post('/:id/apply-overlays', (req: Request, res: Response) => {
  const { overlays } = req.body as { overlays: ImageOverlay[] };
  if (!Array.isArray(overlays)) {
    res.status(400).json({ error: 'Overlays array is required' });
    return;
  }
  const doc = loadDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  doc.overlays = overlays;
  saveDocument(doc);
  res.json({ success: true, document: doc });
});

const exportUpload = multer({ limits: { fileSize: 20 * 1024 * 1024 } });

pdfRouter.post('/:id/export', exportUpload.any(), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    const pages: { index: number; buffer: Buffer; width: number; height: number }[] = [];

    for (const file of files) {
      const match = file.fieldname.match(/^page_(\d+)$/);
      if (match) {
        const idx = parseInt(match[1]);
        const width = Number(req.body[`page_${idx}_width`]);
        const height = Number(req.body[`page_${idx}_height`]);
        if (width > 0 && height > 0) {
          pages.push({ index: idx, buffer: file.buffer, width, height });
        }
      }
    }

    const pdfBuffer = await exportPdf(pages);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="exported.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Export failed:', err);
    res.status(500).json({ error: 'PDF export failed' });
  }
});

pdfRouter.post('/uploads/image', imageUpload.single('image'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image uploaded' });
    return;
  }
  const id = uuidv4();
  const ext = path.extname(req.file.originalname) || '.png';
  const newName = `${id}${ext}`;
  const newPath = path.join(__dirname, '..', '..', 'uploads', 'images', newName);
  fs.renameSync(req.file.path, newPath);
  const url = `/api/pdf/uploads/${newName}`;
  res.json({ success: true, id, url, width: 0, height: 0 });
});

pdfRouter.get('/uploads/:filename', (req: Request, res: Response) => {
  const filePath = path.join(__dirname, '..', '..', 'uploads', 'images', req.params.filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }
  res.sendFile(filePath);
});

pdfRouter.get('/', (_req: Request, res: Response) => {
  const dir = path.join(__dirname, '..', '..', 'uploads', 'documents');
  if (!fs.existsSync(dir)) {
    res.json({ documents: [] });
    return;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const documents = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    return {
      id: data.id,
      name: data.name,
      pageCount: data.metadata?.pageCount,
      updated: fs.statSync(path.join(dir, f)).mtime,
    };
  });

  res.json({ documents });
});
