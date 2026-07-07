import { useRef, useEffect, useState, useCallback } from 'react';
import { useEditorStore } from '../../store';
import { api } from '../../services/api';
import { TextElement, PDFDocument, ImageOverlay } from '../../types';
import { sampleColors } from '../../utils/colors';

const SYSTEM_FONTS = new Set([
  'Helvetica', 'Helvetica Neue', 'Times New Roman', 'Courier New', 'Arial',
  'Palatino', 'Optima', 'Georgia', 'Verdana', 'Trebuchet MS', 'Gill Sans',
  'Futura', 'Avenir', 'Menlo', 'Monaco', 'Lucida Grande', 'Geneva',
]);

function injectFontFace(family: string, ttfUrl: string) {
  const id = `font-${family.replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `@font-face { font-family: '${family}'; src: url('${ttfUrl}') format('truetype'); }`;
  document.head.appendChild(style);
}

let fontManifest: Record<string, string> | null = null;

async function ensureFontsLoaded(doc: PDFDocument) {
  if (!fontManifest) {
    try {
      fontManifest = await (await fetch('/api/fonts/manifest')).json();
    } catch { return; }
  }

  const usedFamilies = new Set<string>();
  for (const page of doc.pages) {
    for (const el of page.elements) {
      if (el.type === 'text' && el.font && !SYSTEM_FONTS.has(el.font)) {
        usedFamilies.add(el.font);
      }
    }
  }

  for (const family of usedFamilies) {
    const filename = fontManifest![family];
    if (filename) injectFontFace(family, `/api/fonts/${filename}`);
  }
}

export function PDFViewer() {
  const { document: doc, pdfUrl, currentPage, zoom, setZoom, setSelectedText, selectElement, updateElement, editedIds, markElementEdited, unmarkElementEdited, pushHistory, updateOverlay, removeOverlay } = useEditorStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [selStartIdx, setSelStartIdx] = useState<number | null>(null);
  const [selEndIdx, setSelEndIdx] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [renderTick, setRenderTick] = useState(0);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const overlayDragRef = useRef<{
    mode: 'move' | 'resize' | 'rotate';
    id: string;
    startX: number;
    startY: number;
    startOX: number;
    startOY: number;
    startOW: number;
    startOH: number;
    startRot: number;
    centerX: number;
    centerY: number;
    corner?: 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
  } | null>(null);
  const textDragRef = useRef<{
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    startBX: number;
    startBY: number;
    startBW: number;
    startBH: number;
    corner?: 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';
  } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const page = doc?.pages?.[currentPage];
  const pw = (page?.width || 612) * zoom;
  const ph = (page?.height || 792) * zoom;
  const imgUrl = pdfUrl ? `${pdfUrl}/page/${currentPage + 1}.png?scale=${Math.max(1, Math.round(zoom * 2))}` : null;
  const textEls = page?.elements.filter(e => e.type === 'text') || [];

  const [fontOpen, setFontOpen] = useState(false);
  const [fontCat, setFontCat] = useState<string | null>(null);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [fonts, setFonts] = useState<Record<string, { file: string | null; category: string }>>({});
  const colorCache = useRef<Map<string, { bg: string; fg: string }>>(new Map());
  const origContentRef = useRef<Map<string, string>>(new Map());

  // Clear cached originals only when a new document is loaded (not on every edit)
  useEffect(() => { origContentRef.current.clear(); }, [doc?.id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingId(null); setSelStartIdx(null); setSelEndIdx(null);
        setFontOpen(false); setFontCat(null); setSizeOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    setPanOffset({ x: 0, y: 0 }); setSelStartIdx(null); setSelEndIdx(null);
    setEditingId(null); setSelectedOverlayId(null);
    setFontOpen(false); setFontCat(null); setSizeOpen(false);
  }, [currentPage]);

  // Auto-resize textarea width when editing starts
  useEffect(() => {
    if (editingId && textareaRef.current) {
      const ta = textareaRef.current;
      ta.style.width = 'auto';
      ta.style.width = ta.scrollWidth + 'px';
    }
  }, [editingId]);

  // Load @font-face for any non-system fonts used in the document
  useEffect(() => {
    if (doc) ensureFontsLoaded(doc);
  }, [doc]);

  useEffect(() => {
    fetch('/api/fonts/manifest').then(r => r.json()).then(data => setFonts(data)).catch(() => {});
  }, []);

  useEffect(() => {
    for (const [family, entry] of Object.entries(fonts)) {
      if (entry.file) injectFontFace(family, `/api/fonts/${entry.file}`);
    }
  }, [fonts]);

  // Lazy-load page elements for unprocessed pages
  const [loadingPage, setLoadingPage] = useState(false);
  useEffect(() => {
    const state = useEditorStore.getState();
    const doc = state.document;
    if (!doc) return;
    const pageData = doc.pages?.[currentPage];
    if (!pageData || pageData.elements.length > 0 || loadingPage) return;
    setLoadingPage(true);
    api.processPage(doc.id, currentPage).then(res => {
      if (res.success) {
        state.setPageElements(currentPage, res.elements);
        if (res.usage) {
          console.log(`🧠 AI grouping page ${currentPage+1} — in=${res.usage.prompt} cached=${res.usage.cached} out=${res.usage.output} tot=${res.usage.total}`);
        }
        setRenderTick(n => n + 1);
      }
    }).catch(err => {
      console.error('Lazy page load failed:', err);
    }).finally(() => setLoadingPage(false));
  }, [currentPage, loadingPage]);

  // [DEBUG] Log element details to browser console for debugging
  // useEffect(() => {
  //   if (!textEls.length) return;
  // 
  //   const yGroups = new Map<number, typeof textEls>();
  //   for (const el of textEls) {
  //     const yKey = Math.round(el.bbox[1] / 3) * 3;
  //     if (!yGroups.has(yKey)) yGroups.set(yKey, []);
  //     yGroups.get(yKey)!.push(el);
  //   }
  // 
  //   const rows = [...yGroups.entries()]
  //     .filter(([_, els]) => els.length >= 2)
  //     .map(([y, els]) => ({ y, els: els.sort((a, b) => a.bbox[0] - b.bbox[0]) }))
  //     .sort((a, b) => a.y - b.y);
  // 
  //   if (rows.length === 0) { console.log('📄 No multi-element rows'); return; }
  // 
  //   const quantized = (v: number) => Math.round(v / 10) * 10;
  //   for (const row of rows) {
  //     for (const el of row.els) {
  //       (el as any)._lx = quantized(el.bbox[0]);
  //       (el as any)._rx = quantized(el.bbox[0] + el.bbox[2]);
  //     }
  //   }
  // 
  //   const leftFreq = new Map<number, Set<number>>();
  //   const rightFreq = new Map<number, Set<number>>();
  //   for (let ri = 0; ri < rows.length; ri++) {
  //     for (const el of rows[ri].els) {
  //       const l = (el as any)._lx;
  //       if (!leftFreq.has(l)) leftFreq.set(l, new Set());
  //       leftFreq.get(l)!.add(ri);
  //       const r = (el as any)._rx;
  //       if (!rightFreq.has(r)) rightFreq.set(r, new Set());
  //       rightFreq.get(r)!.add(ri);
  //     }
  //   }
  // 
  //   const colEdges = [...leftFreq.entries()]
  //     .filter(([_, rowsSet]) => rowsSet.size >= 2)
  //     .map(([x]) => x)
  //     .sort((a, b) => a - b);
  // 
  //   if (colEdges.length < 2) {
  //     console.log('📄 Found rows without aligned columns (likely bullet lists, not a table)');
  //     return;
  //   }
  // 
  //   const tableRows: typeof rows = [];
  //   for (const row of rows) {
  //     const elLefts = row.els.map(el => (el as any)._lx);
  //     const matches = colEdges.filter(e => elLefts.includes(e));
  //     if (matches.length >= 2) tableRows.push(row);
  //   }
  // 
  //   if (tableRows.length < 2) {
  //     console.log('📄 No aligned table structure found');
  //     return;
  //   }
  // 
  //   console.log(`📊 TABLE: ${tableRows.length} rows, ${colEdges.length} column edges at [${colEdges.join(', ')}]`);
  //   for (const { y, els } of tableRows) {
  //     const cols = els.map(e => {
  //       const xs = e.bbox[0];
  //       const xe = e.bbox[0] + e.bbox[2];
  //       return { content: e.content, xs, xe, w: e.bbox[2] };
  //     });
  //     console.log(`  y=${y} | ${cols.map(c => `${c.content}`).join(' │ ')}`);
  //   }
  // }, [textEls, currentPage]);

  // Log groups to browser console (once per page load)
  const groupedRef = useRef<number>(-1);
  useEffect(() => {
    if (!textEls.length || groupedRef.current === currentPage) return;
    groupedRef.current = currentPage;
    const groups = new Map<number, typeof textEls>();
    for (const el of textEls) {
      const gi = el.groupIndex ?? -1;
      if (!groups.has(gi)) groups.set(gi, []);
      groups.get(gi)!.push(el);
    }
    console.log(`📐 Page ${currentPage + 1}: ${[...groups.entries()].filter(([gi]) => gi >= 0).length} groups, ${textEls.length} elements`);
    for (const [gi, els] of [...groups.entries()].sort(([a], [b]) => a - b)) {
      const align = els[0]?.alignment || '?';
      const isTable = (els[0] as any)?.isTable;
      const tableTag = isTable ? ' [TABLE]' : '';
      const label = gi >= 0 ? `Group ${gi}` : 'Ungrouped';
      const snippets = els.map(e => `"${e.content.substring(0, 30)}"`).join(', ');
      console.log(`  ${label} [${align}]${tableTag}: ${snippets}`);
    }
  }, [textEls, currentPage]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const s = useEditorStore.getState();
        s.setZoom(Math.max(0.25, Math.min(5, s.zoom + (e.deltaY > 0 ? -0.05 : 0.05))));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const nearestEl = useCallback((clientX: number, clientY: number): number | null => {
    if (!pageRef.current || !page) return null;
    const rect = pageRef.current.getBoundingClientRect();
    const my = (clientY - rect.top) / zoom;
    const mx = (clientX - rect.left) / zoom;
    for (let i = 0; i < textEls.length; i++) {
      const [ex, ey, ew, eh] = textEls[i].bbox;
      if (mx >= ex && mx <= ex + ew && my >= ey && my <= ey + eh) return i;
    }
    let best: number | null = null, bestDist = Infinity;
    for (let i = 0; i < textEls.length; i++) {
      const [ex, ey, ew, eh] = textEls[i].bbox;
      const dist = Math.abs(my - (ey + eh / 2));
      if (dist < bestDist && mx >= ex - 10 && mx <= ex + ew + 10) { bestDist = dist; best = i; }
    }
    return bestDist < 50 ? best : null;
  }, [page, textEls, zoom]);

  const clearSel = useCallback(() => { setSelStartIdx(null); setSelEndIdx(null); }, []);

  const onMD = useCallback((e: React.MouseEvent) => {
    setFontOpen(false); setFontCat(null); setSizeOpen(false);
    if (selectedOverlayId) setSelectedOverlayId(null);
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      setIsPanning(true); setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y }); e.preventDefault();
      return;
    }
    const idx = nearestEl(e.clientX, e.clientY);
    idx !== null ? (setSelStartIdx(idx), setSelEndIdx(idx)) : clearSel();
  }, [nearestEl, panOffset, clearSel, selectedOverlayId]);

  const onMM = useCallback((e: React.MouseEvent) => {
    if (textDragRef.current) return;
    if (isPanning) { setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y }); return; }
    if (selStartIdx !== null) {
      const idx = nearestEl(e.clientX, e.clientY);
      if (idx !== null) setSelEndIdx(idx);
    }
  }, [isPanning, panStart, selStartIdx, nearestEl]);

  const onMU = useCallback(() => {
    if (textDragRef.current) return;
    if (isPanning) { setIsPanning(false); return; }
    if (selStartIdx !== null && selEndIdx !== null) {
      const s = Math.min(selStartIdx, selEndIdx), e = Math.max(selStartIdx, selEndIdx);
      const texts = textEls.slice(s, e + 1).map(x => x.content).filter(Boolean);
      if (texts.length > 0) {
        setSelectedText(texts.join(' '));
        selectElement(textEls[s].id);
      }
    }
    setIsPanning(false);
  }, [selStartIdx, selEndIdx, textEls, setSelectedText, selectElement]);

  // Extract bg + fg colors from page canvas at bbox position (BEFORE modifying the DOM)
  const extractColorsFromPage = useCallback((elId: string, ex: number, ey: number, ew: number, eh: number) => {
    let bg = '#fff', fg = '#000';
    const imgEl = pageRef.current?.querySelector('img');
    const renderScale = Math.max(1, Math.round(zoom * 2));
    const sx = Math.round(ex * renderScale), sy = Math.round(ey * renderScale);
    const sw = Math.round(ew * renderScale), sh = Math.round(eh * renderScale);
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0 && sw > 0 && sh > 0) {
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, sw, sh);
      const imageData = ctx.getImageData(0, 0, sw, sh);
      const colors = sampleColors(imageData);
      bg = colors.bg; fg = colors.fg;
    }
    colorCache.current.set(elId, { bg, fg });
    return { bg, fg };
  }, [zoom]);

  // Extract bg+fg for AI-applied edits; retries #000 entries when image loads
  useEffect(() => {
    if (!page) return;
    let changed = false;
    for (const id of editedIds) {
      const cached = colorCache.current.get(id);
      if (cached && cached.fg !== '#000') continue;
      const el = page.elements.find(e => e.id === id);
      if (el && 'bbox' in el) {
        const [ex, ey, ew, eh] = (el as TextElement).bbox;
        const { fg } = extractColorsFromPage(id, ex, ey, ew, eh);
        if (fg !== '#000') changed = true;
      }
    }
    if (changed) setRenderTick(n => n + 1);
  }, [editedIds, page, extractColorsFromPage, renderTick]);

  const saveEdit = useCallback(() => {
    if (!editingId || !page) return;
    const el = page.elements.find(x => x.id === editingId);
    if (el && editVal.trim()) {
      const [ex, ey, ew, eh] = el.bbox;
      extractColorsFromPage(editingId, ex, ey, ew, eh);  // extracts from original image BEFORE bg fill
      updateElement(currentPage, editingId, { content: editVal });
      useEditorStore.getState().pushHistory('Edited text');
      markElementEdited(editingId);
      setRenderTick(n => n + 1);
    }
    setEditingId(null);
  }, [editingId, editVal, page, currentPage, updateElement, extractColorsFromPage]);

  const startEdit = useCallback((elId: string, content: string) => {
    setEditingId(elId); setEditVal(content);
    if (!origContentRef.current.has(elId)) {
      origContentRef.current.set(elId, content);
    }
    const el = page?.elements?.find(e => e.id === elId);
    if (el && el.type === 'text') {
      const t = el;
      const style = t.style ? `${t.style.bold ? 'Bold ' : ''}${t.style.italic ? 'Italic' : ''}`.trim() || 'Regular' : 'Regular';
      console.log(
        `✏️ Edit: "${t.content}" ` +
        `font=${t.font || 'Helvetica'} ` +
        `size=${t.fontSize || '?'}px ` +
        `${style} ` +
        `${t.fontError !== undefined ? `err=${(t.fontError * 100).toFixed(1)}% ` : ''}` +
        `${t.confidence ? `ocr=${Math.round(t.confidence * 100)}%` : ''}`
      );
    }
  }, [page]);

  const handleOverlayMouseDown = useCallback((e: React.MouseEvent, overlayId: string, mode: 'move' | 'resize' | 'rotate', corner?: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!doc) return;
    let overlay = doc.overlays?.find(o => o.id === overlayId);
    if (!overlay) return;

    let targetId = overlayId;

    // Split multi-page overlay into page-specific copy before transform
    if (overlay.pageRange.from !== overlay.pageRange.to) {
      const curPageNum = currentPage + 1;
      const state = useEditorStore.getState();
      const allOverlays = [...(state.document?.overlays || [])];
      const idx = allOverlays.findIndex(o => o.id === overlayId);
      if (idx >= 0) {
        const pageSpecific: ImageOverlay = {
          ...overlay,
          id: crypto.randomUUID(),
          pageRange: { from: curPageNum, to: curPageNum },
        };
        const orig = allOverlays[idx];
        if (curPageNum === orig.pageRange.from) {
          orig.pageRange = { from: curPageNum + 1, to: orig.pageRange.to };
          if (orig.pageRange.from <= orig.pageRange.to) {
            allOverlays.splice(idx, 0, pageSpecific);
          } else {
            allOverlays[idx] = pageSpecific;
          }
        } else if (curPageNum === orig.pageRange.to) {
          orig.pageRange = { from: orig.pageRange.from, to: curPageNum - 1 };
          if (orig.pageRange.from <= orig.pageRange.to) {
            allOverlays.splice(idx + 1, 0, pageSpecific);
          } else {
            allOverlays[idx] = pageSpecific;
          }
        } else {
          const tail: ImageOverlay = {
            ...overlay,
            id: crypto.randomUUID(),
            pageRange: { from: curPageNum + 1, to: orig.pageRange.to },
          };
          orig.pageRange = { from: orig.pageRange.from, to: curPageNum - 1 };
          allOverlays.splice(idx + 1, 0, pageSpecific, tail);
        }
        state.updateOverlays(allOverlays);
        targetId = pageSpecific.id;
        setSelectedOverlayId(targetId);
        overlay = pageSpecific;
      }
    }

    pushHistory('Overlay transform');
    overlayDragRef.current = {
      mode,
      id: targetId,
      startX: e.clientX,
      startY: e.clientY,
      startOX: overlay.x,
      startOY: overlay.y,
      startOW: overlay.width,
      startOH: overlay.height,
      startRot: overlay.rotation,
      centerX: (overlay.x + overlay.width / 2) * zoom,
      centerY: (overlay.y + overlay.height / 2) * zoom,
      corner: corner as any,
    };
  }, [doc, zoom, pushHistory, currentPage]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = overlayDragRef.current;
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      if (drag.mode === 'move') {
        updateOverlay(drag.id, { x: drag.startOX + dx, y: drag.startOY + dy });
      } else if (drag.mode === 'resize' && drag.corner) {
        const patch: Record<string, number> = {};
        switch (drag.corner) {
          case 'tl':
            patch.x = drag.startOX + dx;
            patch.y = drag.startOY + dy;
            patch.width = drag.startOW - dx;
            patch.height = drag.startOH - dy;
            break;
          case 'tr':
            patch.y = drag.startOY + dy;
            patch.width = drag.startOW + dx;
            patch.height = drag.startOH - dy;
            break;
          case 'bl':
            patch.x = drag.startOX + dx;
            patch.width = drag.startOW - dx;
            patch.height = drag.startOH + dy;
            break;
          case 'br':
            patch.width = drag.startOW + dx;
            patch.height = drag.startOH + dy;
            break;
          case 't':
            patch.y = drag.startOY + dy;
            patch.height = drag.startOH - dy;
            break;
          case 'b':
            patch.height = drag.startOH + dy;
            break;
          case 'l':
            patch.x = drag.startOX + dx;
            patch.width = drag.startOW - dx;
            break;
          case 'r':
            patch.width = drag.startOW + dx;
            break;
        }
        if (patch.width !== undefined && patch.width < 5) {
          patch.width = 5;
          if (patch.x !== undefined) patch.x = drag.startOX + drag.startOW - 5;
        }
        if (patch.height !== undefined && patch.height < 5) {
          patch.height = 5;
          if (patch.y !== undefined) patch.y = drag.startOY + drag.startOH - 5;
        }
        updateOverlay(drag.id, patch);
      } else if (drag.mode === 'rotate') {
        const curAngle = Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX);
        const startAngle = Math.atan2(drag.startY - drag.centerY, drag.startX - drag.centerX);
        updateOverlay(drag.id, { rotation: drag.startRot + (curAngle - startAngle) * 180 / Math.PI });
      }
    };
    const handleMouseUp = () => { overlayDragRef.current = null; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [zoom, updateOverlay]);

  const startTextDrag = useCallback((e: React.MouseEvent, elId: string, mode: 'move' | 'resize' = 'move', corner?: string) => {
    e.stopPropagation();
    if (!page) return;
    const el = page.elements.find(x => x.id === elId);
    if (!el || !('bbox' in el)) return;
    pushHistory(mode === 'move' ? 'Moved text' : 'Resized text');
    textDragRef.current = {
      id: elId, mode, corner: corner as any,
      startX: e.clientX, startY: e.clientY,
      startBX: el.bbox[0], startBY: el.bbox[1], startBW: el.bbox[2], startBH: el.bbox[3],
    };
  }, [page, pushHistory]);

  useEffect(() => {
    let lastExtract = 0;
    const handleMM = (e: MouseEvent) => {
      const drag = textDragRef.current;
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      let nx = drag.startBX, ny = drag.startBY, nw = drag.startBW, nh = drag.startBH;
      if (drag.mode === 'move') {
        nx = drag.startBX + dx;
        ny = drag.startBY + dy;
      } else if (drag.mode === 'resize' && drag.corner) {
        switch (drag.corner) {
          case 'tl': nx = drag.startBX + dx; ny = drag.startBY + dy; nw = drag.startBW - dx; nh = drag.startBH - dy; break;
          case 'tr': ny = drag.startBY + dy; nw = drag.startBW + dx; nh = drag.startBH - dy; break;
          case 'bl': nx = drag.startBX + dx; nw = drag.startBW - dx; nh = drag.startBH + dy; break;
          case 'br': nw = drag.startBW + dx; nh = drag.startBH + dy; break;
          case 't': ny = drag.startBY + dy; nh = drag.startBH - dy; break;
          case 'b': nh = drag.startBH + dy; break;
          case 'l': nx = drag.startBX + dx; nw = drag.startBW - dx; break;
          case 'r': nw = drag.startBW + dx; break;
        }
        if (nw < 20) { nw = 20; if (nx !== drag.startBX) nx = drag.startBX + drag.startBW - 20; }
        if (nh < 20) { nh = 20; if (ny !== drag.startBY) ny = drag.startBY + drag.startBH - 20; }
      }
      updateElement(currentPage, drag.id, { bbox: [nx, ny, nw, nh] } as any);
      const el = page?.elements?.find(x => x.id === drag.id);
      if (el && el.type === 'text' && el.fontError === undefined && el.confidence === undefined) {
        const now = Date.now();
        if (now - lastExtract > 80) {
          lastExtract = now;
          extractColorsFromPage(drag.id, nx, ny, nw, nh);
          setRenderTick(n => n + 1);
        }
      }
    };
    const handleMU = () => {
      const drag = textDragRef.current;
      if (drag) {
        const el = page?.elements?.find(x => x.id === drag.id);
        if (el && el.type === 'text' && el.fontError === undefined && el.confidence === undefined) {
          extractColorsFromPage(drag.id, el.bbox[0], el.bbox[1], el.bbox[2], el.bbox[3]);
          setRenderTick(n => n + 1);
        }
      }
      textDragRef.current = null;
    };
    window.addEventListener('mousemove', handleMM);
    window.addEventListener('mouseup', handleMU);
    return () => {
      window.removeEventListener('mousemove', handleMM);
      window.removeEventListener('mouseup', handleMU);
    };
  }, [zoom, page, currentPage, updateElement, extractColorsFromPage, setRenderTick]);

  if (!page) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">No pages</div>;

  let selRange: { start: number; end: number } | null = null;
  if (selStartIdx !== null && selEndIdx !== null) {
    selRange = { start: Math.min(selStartIdx, selEndIdx), end: Math.max(selStartIdx, selEndIdx) };
  }

  return (
    <div ref={containerRef} className="w-full h-full overflow-auto bg-gray-100 select-none" onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}>
      <div ref={pageRef} className="relative mx-auto bg-white shadow-xl" style={{ width: pw, minHeight: ph, marginTop: 40, marginBottom: 40, transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}>
        
        <img ref={imgRef} src={imgUrl!} alt="" className="block pointer-events-none select-none" style={{ width: pw, height: ph }} draggable={false} onLoad={() => setRenderTick(n => n + 1)} />

        {/* Selection highlight */}
        {selRange && textEls.slice(selRange.start, selRange.end + 1).map(el => {
          if (el.id === editingId) return null;
          const [ex, ey, ew, eh] = el.bbox;
          const isSingle = selRange.start === selRange.end;
          return (
            <div key={el.id}
              style={{
                position: 'absolute', left: ex * zoom, top: ey * zoom,
                width: ew * zoom, height: eh * zoom,
                background: isSingle ? 'transparent' : 'rgba(59, 130, 246, 0.35)',
                outline: isSingle ? '2px dashed #6366f1' : 'none',
                outlineOffset: 1,
                borderRadius: 2,
                pointerEvents: 'auto',
              }}
            >
              {isSingle ? (
                <div
                  style={{ position: 'absolute', inset: 0, cursor: 'move' }}
                  onDoubleClick={() => startEdit(el.id, el.content)}
                  onMouseDown={(e) => startTextDrag(e, el.id, 'move')}
                />
              ) : (
                <div
                  style={{ position: 'absolute', inset: 0, cursor: 'text' }}
                  onDoubleClick={() => startEdit(el.id, el.content)}
                />
              )}
              {isSingle && (
                <>
                  <div style={{
                    position: 'absolute', left: -5, top: -5,
                    width: 10, height: 10,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'nw-resize', zIndex: 26,
                  }} onMouseDown={e => startTextDrag(e, el.id, 'resize', 'tl')} />
                  <div style={{
                    position: 'absolute', right: -5, top: -5,
                    width: 10, height: 10,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'ne-resize', zIndex: 26,
                  }} onMouseDown={e => startTextDrag(e, el.id, 'resize', 'tr')} />
                  <div style={{
                    position: 'absolute', left: -5, bottom: -5,
                    width: 10, height: 10,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'sw-resize', zIndex: 26,
                  }} onMouseDown={e => startTextDrag(e, el.id, 'resize', 'bl')} />
                  <div style={{
                    position: 'absolute', right: -5, bottom: -5,
                    width: 10, height: 10,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'se-resize', zIndex: 26,
                  }} onMouseDown={e => startTextDrag(e, el.id, 'resize', 'br')} />
                  <div style={{
                    position: 'absolute', left: 'calc(50% - 8px)', top: -4,
                    width: 16, height: 8,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'n-resize', zIndex: 26,
                  }} onMouseDown={e => startTextDrag(e, el.id, 'resize', 't')} />
                  <div style={{
                    position: 'absolute', left: 'calc(50% - 8px)', bottom: -4,
                    width: 16, height: 8,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 's-resize', zIndex: 26,
                  }} onMouseDown={e => startTextDrag(e, el.id, 'resize', 'b')} />
                  <div style={{
                    position: 'absolute', left: -4, top: 'calc(50% - 8px)',
                    width: 8, height: 16,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'w-resize', zIndex: 26,
                  }} onMouseDown={e => startTextDrag(e, el.id, 'resize', 'l')} />
                  <div style={{
                    position: 'absolute', right: -4, top: 'calc(50% - 8px)',
                    width: 8, height: 16,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'e-resize', zIndex: 26,
                  }} onMouseDown={e => startTextDrag(e, el.id, 'resize', 'r')} />
                </>
              )}
            </div>
          );
        })}

        {/* Edited text — per-element positioned text */}
        {(() => {
          const editedEls = textEls.filter(el => editedIds.includes(el.id) && el.id !== editingId);
          if (!editedEls.length) return null;
          return editedEls.map(el => {
            const colors = colorCache.current.get(el.id);
            const bg = colors?.bg || 'transparent';
            const fg = el.style?.color || colors?.fg || '#000';
            const align = el.alignment || 'left';
            const ew = el.bbox[2] * zoom;
            const eh = el.bbox[3] * zoom;
            return (
              <div key={el.id}>
                <div style={{
                  position: 'absolute',
                  left: el.bbox[0] * zoom,
                  top: el.bbox[1] * zoom,
                  width: ew,
                  height: eh,
                  background: bg,
                  zIndex: 10, pointerEvents: 'none',
                }} />
                <div style={{
                  position: 'absolute',
                  left: el.bbox[0] * zoom,
                  top: el.bbox[1] * zoom,
                  width: ew,
                  height: eh,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
                  zIndex: 11, pointerEvents: 'none',
                }}>
                  <span style={{
                    fontFamily: el.font || 'Helvetica',
                    fontSize: (el.fontSize || 11) * zoom,
                    fontWeight: el.style?.bold ? 'bold' : 'normal',
                    fontStyle: el.style?.italic ? 'italic' : 'normal',
                    color: fg,
                    whiteSpace: 'nowrap',
                  }}>{el.content}</span>
                </div>
              </div>
            );
          });
        })()}

        {/* Image overlays */}
        {doc?.overlays?.map(overlay => {
          const inRange = currentPage >= (overlay.pageRange.from - 1) && currentPage <= (overlay.pageRange.to - 1);
          if (!inRange) return null;
          const isSelected = selectedOverlayId === overlay.id;
          return (
            <div key={overlay.id}
              style={{
                position: 'absolute',
                left: overlay.x * zoom,
                top: overlay.y * zoom,
                width: overlay.width * zoom,
                height: overlay.height * zoom,
                transform: `rotate(${overlay.rotation}deg)`,
                transformOrigin: 'center center',
                zIndex: isSelected ? 25 : 5,
                pointerEvents: 'auto',
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (isSelected) {
                  handleOverlayMouseDown(e, overlay.id, 'move');
                } else {
                  setSelectedOverlayId(overlay.id);
                }
              }}
            >
              <img
                src={overlay.imageUrl}
                alt=""
                style={{
                  width: '100%', height: '100%',
                  opacity: overlay.opacity,
                  pointerEvents: 'none',
                  display: 'block',
                }}
                draggable={false}
              />
              {isSelected && (
                <>
                  <div style={{
                    position: 'absolute', inset: 0,
                    border: '2px dashed #6366f1',
                    pointerEvents: 'none',
                    boxSizing: 'border-box',
                  }} />
                  <div style={{
                    position: 'absolute', left: -5, top: -5,
                    width: 10, height: 10,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'nw-resize', zIndex: 26,
                  }} onMouseDown={e => handleOverlayMouseDown(e, overlay.id, 'resize', 'tl')} />
                  <div style={{
                    position: 'absolute', right: -5, top: -5,
                    width: 10, height: 10,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'ne-resize', zIndex: 26,
                  }} onMouseDown={e => handleOverlayMouseDown(e, overlay.id, 'resize', 'tr')} />
                  <div style={{
                    position: 'absolute', left: -5, bottom: -5,
                    width: 10, height: 10,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'sw-resize', zIndex: 26,
                  }} onMouseDown={e => handleOverlayMouseDown(e, overlay.id, 'resize', 'bl')} />
                  <div style={{
                    position: 'absolute', right: -5, bottom: -5,
                    width: 10, height: 10,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'se-resize', zIndex: 26,
                  }} onMouseDown={e => handleOverlayMouseDown(e, overlay.id, 'resize', 'br')} />
                  <div style={{
                    position: 'absolute', left: 'calc(50% - 8px)', top: -4,
                    width: 16, height: 8,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'n-resize', zIndex: 26,
                  }} onMouseDown={e => handleOverlayMouseDown(e, overlay.id, 'resize', 't')} />
                  <div style={{
                    position: 'absolute', left: 'calc(50% - 8px)', bottom: -4,
                    width: 16, height: 8,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 's-resize', zIndex: 26,
                  }} onMouseDown={e => handleOverlayMouseDown(e, overlay.id, 'resize', 'b')} />
                  <div style={{
                    position: 'absolute', left: -4, top: 'calc(50% - 8px)',
                    width: 8, height: 16,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'w-resize', zIndex: 26,
                  }} onMouseDown={e => handleOverlayMouseDown(e, overlay.id, 'resize', 'l')} />
                  <div style={{
                    position: 'absolute', right: -4, top: 'calc(50% - 8px)',
                    width: 8, height: 16,
                    background: '#fff', border: '2px solid #6366f1',
                    borderRadius: 1, cursor: 'e-resize', zIndex: 26,
                  }} onMouseDown={e => handleOverlayMouseDown(e, overlay.id, 'resize', 'r')} />
                  <div style={{
                    position: 'absolute', left: 'calc(50% - 1px)', bottom: '100%',
                    width: 2, height: 22,
                    background: '#6366f1', pointerEvents: 'none',
                  }} />
                  <div style={{
                    position: 'absolute', left: 'calc(50% - 6px)', top: -28,
                    width: 12, height: 12,
                    background: '#6366f1', borderRadius: '50%',
                    cursor: 'grab', zIndex: 26,
                  }} onMouseDown={e => handleOverlayMouseDown(e, overlay.id, 'rotate')} />
                  <div style={{
                    position: 'absolute', right: -10, top: -10,
                    width: 20, height: 20,
                    background: '#ef4444', borderRadius: '50%',
                    color: '#fff', fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontWeight: 'bold', zIndex: 26,
                  }}
                    onClick={(e) => {
                      e.stopPropagation();
                      pushHistory('Removed overlay');
                      removeOverlay(overlay.id);
                      setSelectedOverlayId(null);
                    }}
                  >
                    ×
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Edit textarea */}
        {editingId && (() => {
          const el = textEls.find(e => e.id === editingId);
          if (!el) return null;
          const [ex, ey, ew, eh] = el.bbox;

          const byCat: Record<string, string[]> = {};
          for (const [name, entry] of Object.entries(fonts)) {
            const cat = entry.category || 'sans-serif';
            if (!byCat[cat]) byCat[cat] = [];
            byCat[cat].push(name);
          }
          for (const cat of Object.keys(byCat)) byCat[cat].sort();
          const catOrder = ['sans-serif', 'serif', 'slab-serif', 'mono'];
          const CATEGORY_LABELS: Record<string, string> = {
            'sans-serif': 'Sans-Serif', serif: 'Serif', 'slab-serif': 'Slab Serif',
            mono: 'Monospace',
          };
          const catFonts = fontCat ? (byCat[fontCat] || []) : [];
          const SIZE_OPTIONS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 60, 72];

          const minW = Math.max(50, ew * zoom);
          return (
            <div key="edit-area" style={{ position: 'absolute', left: ex * zoom, top: (ey - 22) * zoom, zIndex: 20, minWidth: minW }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 2,
                fontSize: 10, color: '#6366f1', background: '#eef2ff',
                padding: '1px 4px', borderRadius: '4px 4px 0 0',
                fontFamily: 'monospace', position: 'relative', flexWrap: 'wrap',
              }}>
                {/* Font dropdown */}
                <div style={{ position: 'relative' }}>
                    <button
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); setFontOpen(!fontOpen); setSizeOpen(false); setFontCat(null); }}
                    style={{
                      fontSize: 10, lineHeight: '16px', padding: '0 4px',
                      background: '#e0e7ff', border: '1px solid #6366f1',
                      borderRadius: 3, cursor: 'pointer', color: '#6366f1',
                      fontFamily: el.font || undefined, fontWeight: 600,
                      whiteSpace: 'nowrap', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >
                    {el.font || 'Font'} ▼
                  </button>
                  {fontOpen && (
                    <div style={{
                      position: 'absolute', left: 0, top: '100%', zIndex: 100,
                      background: '#fff', border: '1px solid #6366f1', borderRadius: 4,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)', minWidth: 140, maxHeight: 200, overflow: 'auto',
                      marginTop: 2,
                    }}
                      onMouseDown={e => e.stopPropagation()}
                    >
                      {fontCat === null ? (
                        catOrder.map(cat =>
                          byCat[cat] && byCat[cat].length > 0 ? (
                            <div key={cat}
                              style={{ padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: '#374151' }}
                              onMouseDown={e => { e.stopPropagation(); e.preventDefault(); setFontCat(cat); }}
                            >
                              {CATEGORY_LABELS[cat] || cat}
                            </div>
                          ) : null
                        )
                      ) : (
              <>
                          <div
                            style={{ padding: '3px 8px', cursor: 'pointer', fontSize: 9, color: '#9ca3af', borderBottom: '1px solid #e5e7eb' }}
                            onMouseDown={e => { e.stopPropagation(); e.preventDefault(); setFontCat(null); }}
                          >
                            ← Categories
                          </div>
                          {catFonts.map(name => (
                            <div key={name}
                              style={{ padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontFamily: name }}
                              onMouseDown={e => {
                                e.stopPropagation(); e.preventDefault();
                                updateElement(currentPage, editingId!, { font: name });
                                pushHistory('Changed font');
                                setFontOpen(false);
                                setFontCat(null);
                                setRenderTick(n => n + 1);
                              }}
                            >
                              {name}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Size input + dropdown */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="number"
                    value={el.fontSize || 11}
                    onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}
                    onChange={e => {
                      const v = parseInt(e.target.value);
                      if (v > 0 && v < 200) {
                        updateElement(currentPage, editingId!, { fontSize: v });
                        pushHistory('Changed font size');
                        setRenderTick(n => n + 1);
                      }
                    }}
                    style={{
                      width: 32, fontSize: 10, lineHeight: '14px', padding: '0 2px',
                      background: '#e0e7ff', border: '1px solid #6366f1',
                      borderRadius: '3px 0 0 3px', color: '#6366f1',
                      fontFamily: 'monospace', textAlign: 'center', outline: 'none',
                    }}
                  />
                    <button
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); setSizeOpen(!sizeOpen); setFontOpen(false); }}
                    style={{
                      fontSize: 8, lineHeight: '16px', padding: '0 3px',
                      background: '#e0e7ff', border: '1px solid #6366f1', borderLeft: 'none',
                      borderRadius: '0 3px 3px 0', cursor: 'pointer', color: '#6366f1',
                    }}
                  >
                    ▼
                  </button>
                  {sizeOpen && (
                    <div style={{
                      position: 'absolute', left: 0, top: '100%', zIndex: 100,
                      background: '#fff', border: '1px solid #6366f1', borderRadius: 4,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)', minWidth: 50, maxHeight: 180, overflow: 'auto',
                      marginTop: 2,
                    }}
                      onMouseDown={e => e.stopPropagation()}
                    >
                      {SIZE_OPTIONS.map(s => (
                        <div key={s}
                          style={{
                            padding: '2px 8px', cursor: 'pointer', fontSize: 10,
                            background: (el.fontSize || 11) === s ? '#eef2ff' : 'transparent',
                          }}
                          onMouseDown={e => {
                            e.stopPropagation(); e.preventDefault();
                            updateElement(currentPage, editingId!, { fontSize: s });
                            pushHistory('Changed font size');
                            setSizeOpen(false);
                            setRenderTick(n => n + 1);
                          }}
                        >
                          {s}px
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Alignment toggle */}

                <div style={{ display: 'flex', gap: 1 }}>
                  <div
                    onMouseDown={e => {
                      e.stopPropagation(); e.preventDefault();
                      const next = el.alignment === 'center' ? 'left' : 'center';
                      updateElement(currentPage, editingId!, { alignment: next });
                      pushHistory('Changed alignment');
                      setRenderTick(n => n + 1);
                    }}
                    style={{
                      width: 18, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: '#e0e7ff', border: '1px solid #6366f1', borderRadius: 3, cursor: 'pointer',
                    }}
                    title={el.alignment === 'center' ? 'Align left' : 'Align center'}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      {el.alignment === 'center' ? (
                        <><rect x="0" y="1" width="12" height="2" rx="1" fill="#6366f1"/><rect x="2" y="5" width="8" height="2" rx="1" fill="#6366f1"/><rect x="1" y="9" width="10" height="2" rx="1" fill="#6366f1"/></>
                      ) : (
                        <><rect x="0" y="1" width="12" height="2" rx="1" fill="#6366f1"/><rect x="0" y="5" width="8" height="2" rx="1" fill="#6366f1"/><rect x="0" y="9" width="10" height="2" rx="1" fill="#6366f1"/></>
                      )}
                    </svg>
                  </div>

                  {/* Bold toggle */}
                  <div
                    onMouseDown={e => {
                      e.stopPropagation(); e.preventDefault();
                      updateElement(currentPage, editingId!, { style: { ...el.style, bold: !el.style?.bold } });
                      pushHistory('Toggled bold');
                      setRenderTick(n => n + 1);
                    }}
                    style={{
                      width: 18, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: el.style?.bold ? '#6366f1' : '#e0e7ff',
                      border: '1px solid #6366f1', borderRadius: 3, cursor: 'pointer',
                    }}
                    title={el.style?.bold ? 'Remove bold' : 'Add bold'}
                  >
                    <span style={{
                      fontWeight: 900, fontSize: 11, lineHeight: '14px',
                      color: el.style?.bold ? '#fff' : '#6366f1',
                      fontFamily: 'Helvetica',
                    }}>B</span>
                  </div>
                </div>

                {el.fontError !== undefined && (
                  <span style={{ color: '#ef4444' }}>err: {(el.fontError * 100).toFixed(1)}%</span>
                )}
                {el.confidence ? (
                  <span>ocr: {Math.round(el.confidence * 100)}%</span>
                ) : null}

                <div style={{ flex: 1 }} />

                <button
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    const s = useEditorStore.getState();
                    const orig = origContentRef.current.get(editingId);
                    if (orig !== undefined) {
                      s.updateElement(currentPage, editingId, { content: orig });
                    }
                    s.unmarkElementEdited(editingId);
                    s.pushHistory('Removed edit');
                    setRenderTick(n => n + 1);
                    setEditingId(null);
                  }}
                  style={{
                    fontSize: 10, lineHeight: '16px', padding: '0 5px',
                    background: '#e0e7ff', border: '1px solid #6366f1',
                    borderRadius: 3, cursor: 'pointer', color: '#6366f1',
                    fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap',
                  }}
                >
                  Remove
                </button>
              </div>
              <textarea autoFocus
                ref={textareaRef}
                style={{
                  minWidth: '100%',
                  width: 'auto',
                  minHeight: Math.max(20, eh * zoom),
                  fontFamily: el.font || 'Helvetica',
                  fontSize: (el.fontSize || 11) * zoom,
                  fontWeight: el.style?.bold ? 'bold' : 'normal',
                  fontStyle: el.style?.italic ? 'italic' : 'normal',
                  color: '#000', background: '#fff',
                  border: '2px solid #6366f1', outline: 'none',
                  resize: 'both', padding: '1px 2px', margin: 0,
                  lineHeight: 1.2, overflow: 'hidden',
                }}
                value={editVal}
                onChange={e => {
                  setEditVal(e.target.value);
                  const ta = textareaRef.current;
                  if (ta) {
                    ta.style.width = 'auto';
                    ta.style.width = Math.max(ta.scrollWidth, minW) + 'px';
                  }
                }}
                onBlur={saveEdit}
                onKeyDown={e => {
                  if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                }}
              />
            </div>
          );
        })()}

        {/* Invisible text for clipboard */}
        {textEls.filter(el => !editedIds.includes(el.id) && el.id !== editingId).map(el => {
          const [ex, ey, ew, eh] = el.bbox;
          if (ew <= 0 || eh <= 0 || ex < -5000 || ey < -5000 || ex > 10000 || ey > 10000) return null;
          return (
            <div key={el.id}
              style={{
                position: 'absolute', left: ex * zoom, top: ey * zoom,
                width: ew * zoom, height: eh * zoom,
                fontFamily: el.font || 'Helvetica',
                fontSize: (el.fontSize || 11) * zoom,
                fontWeight: el.style?.bold ? 'bold' : 'normal',
                fontStyle: el.style?.italic ? 'italic' : 'normal',
                color: 'transparent', whiteSpace: 'nowrap', overflow: 'hidden',
                pointerEvents: 'none', userSelect: editingId ? 'none' : 'text', WebkitUserSelect: editingId ? 'none' : 'text',
              }}
            >
              {el.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
