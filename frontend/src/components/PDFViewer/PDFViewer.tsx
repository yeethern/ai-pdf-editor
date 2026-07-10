import { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { useEditorStore } from '../../store';
import { api } from '../../services/api';
import { TextElement, PDFDocument, ImageOverlay } from '../../types';
import { sampleColors } from '../../utils/colors';
import { API_BASE } from '../../config';

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
      fontManifest = await (await fetch(`${API_BASE}/fonts/manifest`)).json();
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
    if (filename) injectFontFace(family, `${API_BASE}/fonts/${filename}`);
  }
}

export function PDFViewer() {
  const {
    document: doc,
    pdfUrl,
    currentPage,
    zoom,
    setZoom,
    setSelectedText,
    selectElement,
    updateElement,
    editedIds,
    markElementEdited,
    unmarkElementEdited,
    pushHistory,
    updateOverlay,
    removeOverlay,
    selectedElementIds,
    setSelectedElementIds,
  } = useEditorStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const panRef = useRef({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const clickStartRef = useRef<{ x: number; y: number } | null>(null);
  const customZoomCenterRef = useRef<{ x: number; y: number } | null>(null);

  // Apply pending scroll adjustments after React updates the DOM width/height for the new zoom level,
  // preventing clamping to the old layout bounds.
  useLayoutEffect(() => {
    if (pendingScrollRef.current && containerRef.current) {
      const { left, top } = pendingScrollRef.current;
      containerRef.current.scrollLeft = Math.max(0, left);
      containerRef.current.scrollTop = Math.max(0, top);
      pendingScrollRef.current = null;
    }
  }, [zoom]);
  const [selStartIdx, setSelStartIdx] = useState<number | null>(null);
  const [selEndIdx, setSelEndIdx] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [renderTick, setRenderTick] = useState(0);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [dragSelectMode, setDragSelectMode] = useState(false);
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
  const editAreaRef = useRef<HTMLDivElement>(null);

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
        setDragSelectMode(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
    setSelStartIdx(null); setSelEndIdx(null);
    setEditingId(null); setSelectedOverlayId(null);
    setFontOpen(false); setFontCat(null); setSizeOpen(false);
    customZoomCenterRef.current = null;
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
    fetch(`${API_BASE}/fonts/manifest`).then(r => r.json()).then(data => setFonts(data)).catch(() => {});
  }, []);

  useEffect(() => {
    for (const [family, entry] of Object.entries(fonts)) {
      if (entry.file) injectFontFace(family, `${API_BASE}/fonts/${entry.file}`);
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
        const container = containerRef.current;
        const pageEl = pageRef.current;
        if (!container || !pageEl) return;

        const store = useEditorStore.getState();
        const oldZoom = store.zoom;
        const newZoom = Math.max(0.25, Math.min(5, oldZoom + (e.deltaY > 0 ? -0.05 : 0.05)));
        if (newZoom === oldZoom) return;

        const page = store.document?.pages?.[store.currentPage];
        if (!page) return;
        const pageW = page.width || 612;
        const pageH = page.height || 792;

        const containerRect = container.getBoundingClientRect();
        const pageRect = pageEl.getBoundingClientRect();

        // Use the center of the container viewport, or the custom zoom center if set
        let zoomX: number;
        let zoomY: number;
        let pdfX: number;
        let pdfY: number;

        if (customZoomCenterRef.current) {
          pdfX = customZoomCenterRef.current.x;
          pdfY = customZoomCenterRef.current.y;
          zoomX = pageRect.left - containerRect.left + pdfX * oldZoom;
          zoomY = pageRect.top - containerRect.top + pdfY * oldZoom;
        } else {
          zoomX = containerRect.width / 2;
          zoomY = containerRect.height / 2;
          pdfX = (containerRect.left + zoomX - pageRect.left) / oldZoom;
          pdfY = (containerRect.top + zoomY - pageRect.top) / oldZoom;
        }

        const oldPw = pageW * oldZoom;
        const newPw = pageW * newZoom;
        const cw = containerRect.width;
        const oldOffsetX = Math.max(0, (cw - oldPw) / 2);
        const newOffsetX = Math.max(0, (cw - newPw) / 2);

        let newScrollLeft = newOffsetX + pageRect.left - oldOffsetX + container.scrollLeft + pdfX * newZoom - (containerRect.left + zoomX);
        let newScrollTop = pageRect.top + container.scrollTop + pdfY * newZoom - (containerRect.top + zoomY);

        pendingScrollRef.current = { left: newScrollLeft, top: newScrollTop };
        store.setZoom(newZoom);
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

  const isClickOnText = useCallback((clientX: number, clientY: number): boolean => {
    if (!pageRef.current || !page) return false;
    const rect = pageRef.current.getBoundingClientRect();
    const my = (clientY - rect.top) / zoom;
    const mx = (clientX - rect.left) / zoom;
    for (let i = 0; i < textEls.length; i++) {
      const [ex, ey, ew, eh] = textEls[i].bbox;
      // Allow a small 3px padding around the text bounding box for easier targeting
      if (mx >= ex - 3 && mx <= ex + ew + 3 && my >= ey - 3 && my <= ey + eh + 3) return true;
    }
    return false;
  }, [page, textEls, zoom]);

  const clearSel = useCallback(() => {
    setSelStartIdx(null);
    setSelEndIdx(null);
    setSelectedElementIds([]);
  }, [setSelectedElementIds]);

  const onDoubleClickPage = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const clickedOnText = isClickOnText(e.clientX, e.clientY);
    if (!clickedOnText) {
      setDragSelectMode(true);
      console.log('➕ Drag select mode activated');
    }
  }, [isClickOnText]);


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
      extractColorsFromPage(editingId, ex, ey, ew, eh);
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

  const onMD = useCallback((e: React.MouseEvent) => {
    setFontOpen(false); setFontCat(null); setSizeOpen(false);
    if (selectedOverlayId) setSelectedOverlayId(null);
    clickStartRef.current = { x: e.clientX, y: e.clientY };

    if (dragSelectMode) {
      if (!pageRef.current) return;
      const rect = pageRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setDragStart({ x, y });
      setDragEnd({ x, y });
      setIsDragSelecting(true);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      const c = containerRef.current!;
      panRef.current = { active: true, startX: e.clientX, startY: e.clientY, scrollLeft: c.scrollLeft, scrollTop: c.scrollTop };
      e.preventDefault();
      return;
    }
    const idx = nearestEl(e.clientX, e.clientY);
    if (idx !== null) {
      setSelStartIdx(idx);
      setSelEndIdx(idx);
    } else {
      clearSel();
      if (editingId) {
        saveEdit();
      }
      const c = containerRef.current!;
      panRef.current = { active: true, startX: e.clientX, startY: e.clientY, scrollLeft: c.scrollLeft, scrollTop: c.scrollTop };
      e.preventDefault();
    }
  }, [nearestEl, clearSel, selectedOverlayId, editingId, saveEdit, dragSelectMode]);

  const onClickPage = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (!clickStartRef.current) return;
    const dx = e.clientX - clickStartRef.current.x;
    const dy = e.clientY - clickStartRef.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 5) return; // Prevent setting center if dragging/panning

    const idx = nearestEl(e.clientX, e.clientY);
    if (idx !== null) return;

    const container = containerRef.current;
    const pageEl = pageRef.current;
    if (!container || !pageEl) return;

    const pageRect = pageEl.getBoundingClientRect();
    const mousePageX = e.clientX - pageRect.left;
    const mousePageY = e.clientY - pageRect.top;

    // Set the custom zoom center (in original PDF page points)
    customZoomCenterRef.current = {
      x: mousePageX / zoom,
      y: mousePageY / zoom,
    };

    console.log(`🎯 Custom zoom center set: x=${customZoomCenterRef.current.x.toFixed(1)}, y=${customZoomCenterRef.current.y.toFixed(1)}`);
  }, [nearestEl, zoom]);

  const onMM = useCallback((e: React.MouseEvent) => {
    if (textDragRef.current) return;
    if (isDragSelecting && dragStart) {
      if (!pageRef.current) return;
      const rect = pageRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      setDragEnd({ x, y });
      return;
    }
    if (panRef.current.active) {
      const c = containerRef.current!;
      const p = panRef.current;
      c.scrollLeft = p.scrollLeft - (e.clientX - p.startX);
      c.scrollTop = p.scrollTop - (e.clientY - p.startY);
      return;
    }
    if (selStartIdx !== null) {
      const idx = nearestEl(e.clientX, e.clientY);
      if (idx !== null) setSelEndIdx(idx);
    }
  }, [selStartIdx, nearestEl, isDragSelecting, dragStart]);

  const onMU = useCallback(() => {
    if (textDragRef.current) return;
    if (isDragSelecting && dragStart && dragEnd) {
      setIsDragSelecting(false);
      setDragSelectMode(false);

      const x1 = Math.min(dragStart.x, dragEnd.x) / zoom;
      const y1 = Math.min(dragStart.y, dragEnd.y) / zoom;
      const x2 = Math.max(dragStart.x, dragEnd.x) / zoom;
      const y2 = Math.max(dragStart.y, dragEnd.y) / zoom;

      const boxW = x2 - x1;
      const boxH = y2 - y1;

      if (boxW > 2 && boxH > 2) {
        const selectedIds: string[] = [];
        for (const el of textEls) {
          const [ex, ey, ew, eh] = el.bbox;
          const overlapX = x1 < (ex + ew) && x2 > ex;
          const overlapY = y1 < (ey + eh) && y2 > ey;
          if (overlapX && overlapY) {
            selectedIds.push(el.id);
          }
        }
        setSelectedElementIds(selectedIds);
        if (selectedIds.length > 0) {
          selectElement(selectedIds[0]);
        } else {
          selectElement(null);
        }
      }
      setDragStart(null);
      setDragEnd(null);
      return;
    }
    if (panRef.current.active) { panRef.current.active = false; return; }
    if (selStartIdx !== null && selEndIdx !== null) {
      const s = Math.min(selStartIdx, selEndIdx), e = Math.max(selStartIdx, selEndIdx);
      const texts = textEls.slice(s, e + 1).map(x => x.content).filter(Boolean);
      if (texts.length > 0) {
        setSelectedText(texts.join(' '));
        selectElement(textEls[s].id);
      }
    }
  }, [selStartIdx, selEndIdx, textEls, setSelectedText, selectElement, isDragSelecting, dragStart, dragEnd, zoom, setSelectedElementIds]);

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
        const candidateX = drag.startOX + dx;
        const candidateY = drag.startOY + dy;
        const pWidth = page?.width || 612;
        const pHeight = page?.height || 792;
        let snapX = candidateX;
        let snapY = candidateY;
        const threshold = 8;

        // Snap X
        if (Math.abs(candidateX + drag.startOW / 2 - pWidth / 2) < threshold) {
          snapX = pWidth / 2 - drag.startOW / 2;
        } else if (Math.abs(candidateX - 0) < threshold) {
          snapX = 0;
        } else if (Math.abs(candidateX + drag.startOW - pWidth) < threshold) {
          snapX = pWidth - drag.startOW;
        }

        // Snap Y
        if (Math.abs(candidateY + drag.startOH / 2 - pHeight / 2) < threshold) {
          snapY = pHeight / 2 - drag.startOH / 2;
        } else if (Math.abs(candidateY - 0) < threshold) {
          snapY = 0;
        } else if (Math.abs(candidateY + drag.startOH - pHeight) < threshold) {
          snapY = pHeight - drag.startOH;
        }

        updateOverlay(drag.id, { x: snapX, y: snapY });
      } else if (drag.mode === 'resize' && drag.corner) {
        const patch: Record<string, number> = {};
        switch (drag.corner) {
          case 'tl': case 'tr': case 'bl': case 'br': {
            const ratio = drag.startOW / drag.startOH;
            let nw: number, nh: number;
            if (Math.abs(dx) >= Math.abs(dy)) {
              nw = drag.corner === 'tr' || drag.corner === 'br' ? drag.startOW + dx : drag.startOW - dx;
              nh = nw / ratio;
            } else {
              nh = drag.corner === 'bl' || drag.corner === 'br' ? drag.startOH + dy : drag.startOH - dy;
              nw = nh * ratio;
            }
            if (nw < 5) { nw = 5; nh = nw / ratio; }
            if (nh < 5) { nh = 5; nw = nh * ratio; }
            patch.width = nw; patch.height = nh;
            if (drag.corner === 'tl') { patch.x = drag.startOX + drag.startOW - nw; patch.y = drag.startOY + drag.startOH - nh; }
            else if (drag.corner === 'tr') { patch.x = drag.startOX; patch.y = drag.startOY + drag.startOH - nh; }
            else if (drag.corner === 'bl') { patch.x = drag.startOX + drag.startOW - nw; patch.y = drag.startOY; }
            else { patch.x = drag.startOX; patch.y = drag.startOY; }
            break;
          }
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
  }, [zoom, updateOverlay, page]);

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
          case 'tl': case 'tr': case 'bl': case 'br': {
            const ratio = drag.startBW / drag.startBH;
            if (Math.abs(dx) >= Math.abs(dy)) {
              nw = drag.corner === 'tr' || drag.corner === 'br' ? drag.startBW + dx : drag.startBW - dx;
              nh = nw / ratio;
            } else {
              nh = drag.corner === 'bl' || drag.corner === 'br' ? drag.startBH + dy : drag.startBH - dy;
              nw = nh * ratio;
            }
            if (nw < 20) { nw = 20; nh = nw / ratio; }
            if (nh < 20) { nh = 20; nw = nh * ratio; }
            if (drag.corner === 'tl') { nx = drag.startBX + drag.startBW - nw; ny = drag.startBY + drag.startBH - nh; }
            else if (drag.corner === 'tr') { ny = drag.startBY + drag.startBH - nh; }
            else if (drag.corner === 'bl') { nx = drag.startBX + drag.startBW - nw; }
            break;
          }
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

  const activeOverlay = selectedOverlayId ? doc?.overlays?.find(o => o.id === selectedOverlayId) : null;
  const showVLine = activeOverlay && Math.abs(activeOverlay.x + activeOverlay.width / 2 - (page?.width || 612) / 2) < 0.01;
  const showHLine = activeOverlay && Math.abs(activeOverlay.y + activeOverlay.height / 2 - (page?.height || 792) / 2) < 0.01;
  const showLeftLine = activeOverlay && Math.abs(activeOverlay.x - 0) < 0.01;
  const showRightLine = activeOverlay && Math.abs(activeOverlay.x + activeOverlay.width - (page?.width || 612)) < 0.01;
  const showTopLine = activeOverlay && Math.abs(activeOverlay.y - 0) < 0.01;
  const showBottomLine = activeOverlay && Math.abs(activeOverlay.y + activeOverlay.height - (page?.height || 792)) < 0.01;

  return (
    <div ref={containerRef} className="w-full h-full overflow-auto bg-gray-100 select-none" onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}>
      <div
        ref={pageRef}
        className="relative mx-auto bg-white shadow-xl overflow-hidden"
        style={{ width: pw, minHeight: ph, marginTop: 40, marginBottom: 40, cursor: dragSelectMode ? 'crosshair' : 'default' }}
        onClick={onClickPage}
        onDoubleClick={onDoubleClickPage}
      >
        
        <img ref={imgRef} src={imgUrl!} alt="" className="block pointer-events-none select-none" style={{ width: pw, height: ph }} draggable={false} onLoad={() => setRenderTick(n => n + 1)} />

        {/* Snapping Guidelines */}
        {showVLine && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: ((page?.width || 612) / 2) * zoom,
            width: 1.5, borderLeft: '1.5px dashed #3b82f6', zIndex: 15, pointerEvents: 'none',
          }} />
        )}
        {showHLine && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: ((page?.height || 792) / 2) * zoom,
            height: 1.5, borderTop: '1.5px dashed #3b82f6', zIndex: 15, pointerEvents: 'none',
          }} />
        )}
        {showLeftLine && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: 0,
            width: 1.5, borderLeft: '1.5px dashed #ef4444', zIndex: 15, pointerEvents: 'none',
          }} />
        )}
        {showRightLine && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: (page?.width || 612) * zoom - 1.5,
            width: 1.5, borderLeft: '1.5px dashed #ef4444', zIndex: 15, pointerEvents: 'none',
          }} />
        )}
        {showTopLine && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: 0,
            height: 1.5, borderTop: '1.5px dashed #ef4444', zIndex: 15, pointerEvents: 'none',
          }} />
        )}
        {showBottomLine && (
          <div style={{
            position: 'absolute', left: 0, right: 0, top: (page?.height || 792) * zoom - 1.5,
            height: 1.5, borderTop: '1.5px dashed #ef4444', zIndex: 15, pointerEvents: 'none',
          }} />
        )}

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
                zIndex: 26,
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

        {/* Highlight for drag-selected elements */}
        {selectedElementIds.map(id => {
          const el = textEls.find(e => e.id === id);
          if (!el || el.id === editingId) return null;
          const [ex, ey, ew, eh] = el.bbox;
          return (
            <div key={`drag-sel-${el.id}`}
              style={{
                position: 'absolute', left: ex * zoom, top: ey * zoom,
                width: ew * zoom, height: eh * zoom,
                background: 'rgba(59, 130, 246, 0.22)',
                outline: '1.5px dashed #3b82f6',
                borderRadius: 2,
                pointerEvents: 'none',
                zIndex: 26,
              }}
            />
          );
        })}

        {/* Visual Drag Selection Outline */}
        {isDragSelecting && dragStart && dragEnd && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(dragStart.x, dragEnd.x),
              top: Math.min(dragStart.y, dragEnd.y),
              width: Math.abs(dragStart.x - dragEnd.x),
              height: Math.abs(dragStart.y - dragEnd.y),
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              border: '1.5px solid rgba(59, 130, 246, 0.75)',
              borderRadius: '4px',
              zIndex: 30,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Edited text — per-element positioned text */}
        {(() => {
          const editedEls = textEls.filter(el => editedIds.includes(el.id) && el.id !== editingId);
          if (!editedEls.length) return null;
          return editedEls.map(el => {
            const isUserText = el.fontError === undefined && el.confidence === undefined;
            const colors = colorCache.current.get(el.id);
            const fg = el.style?.color || colors?.fg || '#000';
            const align = el.alignment || 'left';
            const ew = el.bbox[2] * zoom;
            const eh = el.bbox[3] * zoom;
            const cover = el.coverBbox;
            return (
              <div key={el.id}>
                {(isUserText || cover) && (() => {
                  const bg = colors?.bg || 'transparent';
                  const bx = cover ? cover[0] * zoom : el.bbox[0] * zoom;
                  const by = cover ? cover[1] * zoom : el.bbox[1] * zoom;
                  const bw = cover ? cover[2] * zoom : ew;
                  const bh = cover ? cover[3] * zoom : eh;
                  return <div style={{
                    position: 'absolute',
                    left: bx,
                    top: by,
                    width: bw,
                    height: bh,
                    background: bg,
                    zIndex: 10, pointerEvents: 'none',
                  }} />;
                })()}
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

        {/* QR code cover rectangles */}
        {doc?.qrCodeCoverActions?.map(action => {
          const inRange = currentPage >= (action.pageRange.from - 1) && currentPage <= (action.pageRange.to - 1);
          if (!inRange || !action.coverQR) return null;

          const qrsOnPage = (doc.detectedQRCodes || []).filter(q => q.page === currentPage);
          if (qrsOnPage.length === 0) return null;

          return qrsOnPage.map(qr => {
            const padding = 10;
            const paddedBbox: [number, number, number, number] = [
              qr.bbox[0] - padding,
              qr.bbox[1] - padding,
              qr.bbox[2] + padding * 2,
              qr.bbox[3] + padding * 2,
            ];
            const { bg } = extractColorsFromPage(
              `qr-${qr.id}`, paddedBbox[0], paddedBbox[1], paddedBbox[2], paddedBbox[3],
            );

            const qrBottom = qr.bbox[1] + qr.bbox[3];
            const qrLeft = qr.bbox[0];
            const qrRight = qr.bbox[0] + qr.bbox[2];
            const coverDescElements = action.coverDesc
              ? (() => {
                  let closest: TextElement | null = null;
                  let minGap = Infinity;
                  for (const el of textEls) {
                    const [ex, ey, ew] = el.bbox;
                    const elRight = ex + ew;
                    if (ey < qrBottom) continue;
                    if (elRight < qrLeft || ex > qrRight) continue;
                    const gap = ey - qrBottom;
                    if (gap < minGap) {
                      minGap = gap;
                      closest = el;
                    }
                  }
                  return closest ? [closest] : [];
                })()
              : [];

            return (
              <div key={qr.id}>
                <div style={{
                  position: 'absolute',
                  left: paddedBbox[0] * zoom,
                  top: paddedBbox[1] * zoom,
                  width: paddedBbox[2] * zoom,
                  height: paddedBbox[3] * zoom,
                  background: bg,
                  zIndex: 12,
                  pointerEvents: 'none',
                }} />
                {coverDescElements.map(el => {
                  const [ex, ey, ew, eh] = el.bbox;
                  return (
                    <div key={el.id} style={{
                      position: 'absolute',
                      left: ex * zoom,
                      top: ey * zoom,
                      width: ew * zoom,
                      height: eh * zoom,
                      background: bg,
                      zIndex: 12,
                      pointerEvents: 'none',
                    }} />
                  );
                })}
              </div>
            );
          });
        })}

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
                if (isClickOnText(e.clientX, e.clientY)) {
                  return;
                }
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
            <div ref={editAreaRef} key="edit-area" style={{ position: 'absolute', left: ex * zoom, top: (ey - 22) * zoom, zIndex: 20, minWidth: minW }}>
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
                    onMouseDown={e => { e.stopPropagation(); }}
                    onChange={e => {
                      const v = parseInt(e.target.value);
                      if (v > 0 && v < 200) {
                        updateElement(currentPage, editingId!, { fontSize: v });
                        pushHistory('Changed font size');
                        setRenderTick(n => n + 1);
                      }
                    }}
                    onBlur={e => {
                      if (e.relatedTarget && editAreaRef.current?.contains(e.relatedTarget as Node)) {
                        return;
                      }
                      saveEdit();
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                      if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
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
                    e.preventDefault();
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
                onBlur={e => {
                  if (e.relatedTarget && editAreaRef.current?.contains(e.relatedTarget as Node)) {
                    return;
                  }
                  saveEdit();
                }}
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
