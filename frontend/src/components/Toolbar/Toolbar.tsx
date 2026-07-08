import { useEditorStore } from '../../store';
import { TextElement, DetectedQRCode, QRCodeCoverAction } from '../../types';
import { sampleColors } from '../../utils/colors';
import { API_BASE } from '../../config';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function sampleFromImage(
  img: HTMLImageElement,
  ex: number, ey: number, ew: number, eh: number,
  scale: number
): { bg: string; fg: string } {
  const sx = Math.round(ex * scale);
  const sy = Math.round(ey * scale);
  const sw = Math.round(ew * scale);
  const sh = Math.round(eh * scale);
  if (sw < 2 || sh < 2) return { bg: '#fff', fg: '#000' };
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return sampleColors(ctx.getImageData(0, 0, sw, sh));
}

async function renderPageBlob(
  pageImg: HTMLImageElement,
  elements: TextElement[],
  editedIds: string[],
  overlays: { imageUrl: string; pageRange: { from: number; to: number }; x: number; y: number; width: number; height: number; rotation: number; opacity: number }[],
  overlayCache: Map<string, HTMLImageElement>,
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
  scale: number,
  qrCoverActions?: QRCodeCoverAction[],
  qrCodes?: DetectedQRCode[],
): Promise<Blob> {
  const cw = pageWidth * scale;
  const ch = pageHeight * scale;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(pageImg, 0, 0, cw, ch);

  const editedOnPage = elements.filter(el => el.type === 'text' && editedIds.includes(el.id));

  for (const el of editedOnPage) {
    if (el.type !== 'text') continue;
    const colors = sampleFromImage(pageImg, el.bbox[0], el.bbox[1], el.bbox[2], el.bbox[3], scale);
    const [ex, ey, ew, eh] = el.bbox;
    const sx = ex * scale;
    const sy = ey * scale;
    const sw = ew * scale;
    const sh = eh * scale;

    const isUserText = el.fontError === undefined && el.confidence === undefined;
    const cover = el.coverBbox;
    if (isUserText || cover) {
      const bg = colors.bg || '#fff';
      if (cover) {
        const csx = cover[0] * scale;
        const csy = cover[1] * scale;
        const csw = cover[2] * scale;
        const csh = cover[3] * scale;
        ctx.fillStyle = bg;
        ctx.fillRect(Math.max(0, csx - 1), Math.max(0, csy - 1), Math.min(csw + 2, cw - csx + 1), Math.min(csh + 2, ch - csy + 1));
      } else {
        ctx.fillStyle = bg;
        ctx.fillRect(Math.max(0, sx - 1), Math.max(0, sy - 1), Math.min(sw + 2, cw - sx + 1), Math.min(sh + 2, ch - sy + 1));
      }
    }

    const fg = el.style?.color || colors.fg || '#000';
    const fontSize = Math.max(4, (el.fontSize || 11) * scale);
    ctx.font = `${el.style?.italic ? 'italic ' : ''}${el.style?.bold ? 'bold ' : ''}${fontSize}px "${el.font || 'Helvetica'}"`;
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText(el.content);
    const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const visualCenter = metrics.actualBoundingBoxAscent - textHeight / 2;
    ctx.fillText(el.content, sx + sw / 2, sy + sh / 2 + visualCenter);
  }

  // QR cover rectangles
  if (qrCoverActions && qrCodes) {
    for (const action of qrCoverActions) {
      const inRange = pageIndex >= (action.pageRange.from - 1) && pageIndex <= (action.pageRange.to - 1);
      if (!inRange || !action.coverQR) continue;

      const qrs = qrCodes.filter(q => q.page === pageIndex);
      for (const qr of qrs) {
        const [qx, qy, qw, qh] = qr.bbox;
        const padding = 10;
        const padBbox = [qx - padding, qy - padding, qw + padding * 2, qh + padding * 2];
        const colors = sampleFromImage(pageImg, padBbox[0], padBbox[1], padBbox[2], padBbox[3], scale);
        ctx.fillStyle = colors.bg || action.color;
        ctx.fillRect(padBbox[0] * scale, padBbox[1] * scale, padBbox[2] * scale, padBbox[3] * scale);

        if (action.coverDesc) {
          const qrBottom = qy + qh;
          let closest: TextElement | null = null;
          let minGap = Infinity;
          for (const el of elements) {
            const [ex, ey, ew] = el.bbox;
            const elRight = ex + ew;
            if (ey < qrBottom) continue;
            if (elRight < qx || ex > qx + qw) continue;
            const gap = ey - qrBottom;
            if (gap < minGap) { minGap = gap; closest = el; }
          }
          if (closest) {
            const [cex, cey, cew, ceh] = closest.bbox;
            const descColors = sampleFromImage(pageImg, cex, cey, cew, ceh, scale);
            ctx.fillStyle = descColors.bg || action.color;
            ctx.fillRect(cex * scale, cey * scale, cew * scale, ceh * scale);
          }
        }
      }
    }
  }

  for (const overlay of overlays) {
    const inRange = pageIndex >= (overlay.pageRange.from - 1) && pageIndex <= (overlay.pageRange.to - 1);
    if (!inRange) continue;
    const img = overlayCache.get(overlay.imageUrl);
    if (!img) continue;
    const cx = (overlay.x + overlay.width / 2) * scale;
    const cy = (overlay.y + overlay.height / 2) * scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(overlay.rotation * Math.PI / 180);
    ctx.globalAlpha = overlay.opacity;
    ctx.drawImage(img, -overlay.width * scale / 2, -overlay.height * scale / 2, overlay.width * scale, overlay.height * scale);
    ctx.restore();
  }

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
}

export function Toolbar() {
  const {
    document,
    currentPage,
    zoom,
    editHistory,
    historyIndex,
    showAIPanel,
    showSkillPanel,
    showStylePanel,
    setCurrentPage,
    setZoom,
    toggleAIPanel,
    toggleSkillPanel,
    toggleStylePanel,
    undo,
    redo,
    addElement,
    markElementEdited,
    pushHistory,
  } = useEditorStore();

  const pageCount = document?.pages?.length || 0;

  const zoomIn = () => setZoom(zoom + 0.1);
  const zoomOut = () => setZoom(zoom - 0.1);
  const zoomReset = () => setZoom(1);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < editHistory.length - 1;

  const handleDownload = async () => {
    if (!document) return;
    const state = useEditorStore.getState();
    const { editedIds, pdfUrl } = state;
    const scale = 3;

    const overlayCache = new Map<string, HTMLImageElement>();
    for (const overlay of document.overlays || []) {
      if (!overlayCache.has(overlay.imageUrl)) {
        try {
          const img = await loadImage(overlay.imageUrl);
          overlayCache.set(overlay.imageUrl, img);
        } catch {}
      }
    }

    const formData = new FormData();

    for (let pi = 0; pi < document.pages.length; pi++) {
      const page = document.pages[pi];
      const pw = page.width;
      const ph = page.height;

      const pageImg = await loadImage(`${pdfUrl}/page/${pi + 1}.png?scale=${scale}`);

      const blob = await renderPageBlob(
        pageImg,
        page.elements.filter((e): e is TextElement => e.type === 'text'),
        editedIds,
        document.overlays || [],
        overlayCache,
        pi,
        pw,
        ph,
        scale,
        document.qrCodeCoverActions,
        document.detectedQRCodes,
      );

      formData.append(`page_${pi}`, blob, `page_${pi}.png`);
      formData.append(`page_${pi}_width`, String(pw));
      formData.append(`page_${pi}_height`, String(ph));
    }

    const res = await fetch(`${API_BASE}/pdf/${document.id}/export`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${document.name || 'exported'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-12 bg-white border-b border-gray-200 flex items-center px-3 gap-1 shrink-0 z-20">
      <div className="flex items-center gap-1 mr-4">
        <span className="text-sm font-semibold text-gray-700 truncate max-w-[200px]">
          {document?.name || 'Untitled'}
        </span>
      </div>

      <div className="flex items-center gap-0.5 border-r border-gray-200 pr-3 mr-3">
        <button
          className="btn-ghost p-1.5 rounded"
          onClick={undo}
          disabled={!canUndo}
          title="Undo"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
        <button
          className="btn-ghost p-1.5 rounded"
          onClick={redo}
          disabled={!canRedo}
          title="Redo"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-1 mr-auto">
        <button
          className="btn-ghost p-1.5 rounded text-xs"
          onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
          disabled={currentPage <= 0}
        >
          ◀
        </button>
        <span className="text-xs text-gray-600 min-w-[60px] text-center">
          {pageCount > 0 ? `${currentPage + 1} / ${pageCount}` : '0 / 0'}
        </span>
        <button
          className="btn-ghost p-1.5 rounded text-xs"
          onClick={() => setCurrentPage(Math.min(pageCount - 1, currentPage + 1))}
          disabled={currentPage >= pageCount - 1}
        >
          ▶
        </button>
      </div>

      <div className="flex items-center gap-1 border-r border-gray-200 pr-3 mr-3">
        <button className="btn-ghost p-1.5 rounded text-xs" onClick={zoomOut} title="Zoom out">
          −
        </button>
        <span className="text-xs text-gray-600 min-w-[40px] text-center font-mono">
          {Math.round(zoom * 100)}%
        </span>
        <button className="btn-ghost p-1.5 rounded text-xs" onClick={zoomIn} title="Zoom in">
          +
        </button>
        <button className="btn-ghost p-1.5 rounded text-xs" onClick={zoomReset} title="Reset zoom">
          ⊹
        </button>
      </div>

      <div className="flex items-center gap-1 border-r border-gray-200 pr-3 mr-3">
        <button
          className="btn-ghost p-1.5 rounded text-xs font-medium text-brand-600"
          onClick={() => {
            if (!document) return;
            const page = document.pages[currentPage];
            if (!page) return;
            const id = crypto.randomUUID();
            const cx = page.width / 2;
            const cy = page.height / 2;
            addElement(currentPage, {
              id,
              type: 'text',
              content: 'New Text',
              bbox: [cx - 75, cy - 15, 150, 30],
              font: 'Helvetica',
              fontSize: 16,
              editable: true,
              page: currentPage,
              style: { color: '#000000' },
            });
            markElementEdited(id);
            pushHistory('Added text');
          }}
          title="Add Text"
        >
          + Text
        </button>
      </div>

      <button
        className={`btn-ghost p-1.5 rounded text-xs ${showAIPanel ? 'bg-brand-100 text-brand-700' : ''}`}
        onClick={toggleAIPanel}
        title="AI Transformation"
      >
        AI
      </button>

      <button
        className={`btn-ghost p-1.5 rounded text-xs ${showSkillPanel ? 'bg-brand-100 text-brand-700' : ''}`}
        onClick={toggleSkillPanel}
        title="Skills"
      >
        Skills
      </button>

      <button
        className={`btn-ghost p-1.5 rounded text-xs ${showStylePanel ? 'bg-brand-100 text-brand-700' : ''}`}
        onClick={toggleStylePanel}
        title="Rule-Based Editing"
      >
        Style
      </button>

      <button
        className="btn-ghost p-1.5 rounded text-xs ml-1"
        onClick={handleDownload}
        title="Download PDF"
      >
        Download
      </button>
    </div>
  );
}
