import { useRef, useState, useCallback, useEffect } from 'react';

interface OverlayPreviewCanvasProps {
  pageImageUrl: string | null;
  pageWidth: number;
  pageHeight: number;
  overlayImageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  pageRange: { from: number; to: number };
  totalPages: number;
  previewPage: number;
  onTransformChange: (p: { x?: number; y?: number; width?: number; height?: number; rotation?: number; opacity?: number }) => void;
  onPageRangeChange: (r: { from: number; to: number }) => void;
  onPageChange: (p: number) => void;
  onDelete: () => void;
}

export function OverlayPreviewCanvas({
  pageImageUrl, pageWidth, pageHeight, overlayImageUrl,
  x, y, width, height, rotation, opacity, pageRange, totalPages,
  previewPage, onTransformChange, onPageRangeChange, onPageChange, onDelete,
}: OverlayPreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'move' | 'resize' | 'rotate' | null>(null);
  const dragStartRef = useRef({ mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0, rot: 0, corner: '' });

  const scale = Math.min(1, 336 / pageWidth);
  const pw = pageWidth * scale;
  const ph = pageHeight * scale;
  const ox = x * scale;
  const oy = y * scale;
  const ow = width * scale;
  const oh = height * scale;

  const handleMD = useCallback((e: React.MouseEvent, mode: 'move' | 'resize' | 'rotate', corner = '') => {
    e.preventDefault();
    e.stopPropagation();
    dragStartRef.current = { mx: e.clientX, my: e.clientY, x, y, w: width, h: height, rot: rotation, corner };
    setDragging(mode);
  }, [x, y, width, height, rotation]);

  useEffect(() => {
    if (!dragging) return;
    const ds = dragStartRef.current;
    const onMM = (e: MouseEvent) => {
      const dx = (e.clientX - ds.mx) / scale;
      const dy = (e.clientY - ds.my) / scale;
      if (dragging === 'move') {
        onTransformChange({ x: ds.x + dx, y: ds.y + dy });
      } else if (dragging === 'resize') {
        const patch: Record<string, number> = {};
        switch (ds.corner) {
          case 'tl': case 'tr': case 'bl': case 'br': {
            const ratio = ds.w / ds.h;
            let nw: number, nh: number;
            if (Math.abs(dx) >= Math.abs(dy)) {
              nw = ds.corner === 'tr' || ds.corner === 'br' ? ds.w + dx : ds.w - dx;
              nh = nw / ratio;
            } else {
              nh = ds.corner === 'bl' || ds.corner === 'br' ? ds.h + dy : ds.h - dy;
              nw = nh * ratio;
            }
            if (nw < 5) { nw = 5; nh = nw / ratio; }
            if (nh < 5) { nh = 5; nw = nh * ratio; }
            patch.width = nw; patch.height = nh;
            if (ds.corner === 'tl') { patch.x = ds.x + ds.w - nw; patch.y = ds.y + ds.h - nh; }
            else if (ds.corner === 'tr') { patch.x = ds.x; patch.y = ds.y + ds.h - nh; }
            else if (ds.corner === 'bl') { patch.x = ds.x + ds.w - nw; patch.y = ds.y; }
            else { patch.x = ds.x; patch.y = ds.y; }
            break;
          }
          case 't':
            patch.y = ds.y + dy; patch.height = ds.h - dy;
            break;
          case 'b':
            patch.height = ds.h + dy;
            break;
          case 'l':
            patch.x = ds.x + dx; patch.width = ds.w - dx;
            break;
          case 'r':
            patch.width = ds.w + dx;
            break;
        }
        onTransformChange(patch);
      } else if (dragging === 'rotate') {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mx = (e.clientX - rect.left) / scale;
        const my = (e.clientY - rect.top) / scale;
        const cx = ds.x + ds.w / 2;
        const cy = ds.y + ds.h / 2;
        const angle = Math.atan2(my - cy, mx - cx) * (180 / Math.PI);
        onTransformChange({ rotation: angle - 90 });
      }
    };
    const onMU = () => setDragging(null);
    window.addEventListener('mousemove', onMM);
    window.addEventListener('mouseup', onMU);
    return () => { window.removeEventListener('mousemove', onMM); window.removeEventListener('mouseup', onMU); };
  }, [dragging, scale, onTransformChange]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="relative bg-white rounded overflow-hidden" style={{ width: pw, height: ph, margin: '0 auto', boxShadow: '0 0 0 1px #d1d5db' }}>
        {pageImageUrl ? (
          <img src={pageImageUrl} alt="" className="absolute inset-0 w-full h-full pointer-events-none select-none" draggable={false} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">Page preview</div>
        )}
        <div
          ref={overlayRef}
          className="absolute cursor-move"
          style={{
            left: ox, top: oy, width: ow, height: oh,
            transform: `rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            opacity,
            outline: dragging ? '2px solid #6366f1' : 'none',
          }}
          onMouseDown={e => handleMD(e, 'move')}
        >
          <img
            src={overlayImageUrl}
            alt=""
            className="w-full h-full pointer-events-none select-none"
            draggable={false}
            style={{ opacity: 1 }}
          />
          <div className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center shadow z-10"
            onMouseDown={e => { e.stopPropagation(); onDelete(); }}
          >✕</div>
          <div className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-white border-2 border-indigo-500 cursor-nw-resize z-10"
            onMouseDown={e => handleMD(e, 'resize', 'tl')} />
          <div className="absolute -right-1.5 -top-1.5 w-3 h-3 bg-white border-2 border-indigo-500 cursor-ne-resize z-10"
            onMouseDown={e => handleMD(e, 'resize', 'tr')} />
          <div className="absolute -left-1.5 -bottom-1.5 w-3 h-3 bg-white border-2 border-indigo-500 cursor-sw-resize z-10"
            onMouseDown={e => handleMD(e, 'resize', 'bl')} />
          <div className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border-2 border-indigo-500 cursor-se-resize z-10"
            onMouseDown={e => handleMD(e, 'resize', 'br')} />
          <div className="absolute left-1/2 -translate-x-1/2 -top-1.5 w-4 h-1.5 bg-white border-2 border-indigo-500 cursor-n-resize z-10"
            onMouseDown={e => handleMD(e, 'resize', 't')} />
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-4 h-1.5 bg-white border-2 border-indigo-500 cursor-s-resize z-10"
            onMouseDown={e => handleMD(e, 'resize', 'b')} />
          <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-4 bg-white border-2 border-indigo-500 cursor-w-resize z-10"
            onMouseDown={e => handleMD(e, 'resize', 'l')} />
          <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-1.5 h-4 bg-white border-2 border-indigo-500 cursor-e-resize z-10"
            onMouseDown={e => handleMD(e, 'resize', 'r')} />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-5 w-3 h-3 bg-indigo-500 rounded-full cursor-grab z-10"
            onMouseDown={e => handleMD(e, 'rotate')}>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0.5 h-3 bg-indigo-500" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <button className="btn-ghost px-1 py-0.5" disabled={previewPage <= 0} onClick={() => onPageChange(previewPage - 1)}>◀</button>
        <span>Page {previewPage + 1} of {totalPages}</span>
        <button className="btn-ghost px-1 py-0.5" disabled={previewPage >= totalPages - 1} onClick={() => onPageChange(previewPage + 1)}>▶</button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500 w-16">Pages:</span>
        <input type="range" min={1} max={totalPages} value={pageRange.from} onChange={e => onPageRangeChange({ ...pageRange, from: Math.min(Number(e.target.value), pageRange.to) })} className="w-16" />
        <span className="text-gray-400 w-4 text-center">{pageRange.from}</span>
        <span className="text-gray-300">–</span>
        <span className="text-gray-400 w-4 text-center">{pageRange.to}</span>
        <input type="range" min={1} max={totalPages} value={pageRange.to} onChange={e => onPageRangeChange({ ...pageRange, to: Math.max(Number(e.target.value), pageRange.from) })} className="w-16" />
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500 w-16">Opacity:</span>
        <input type="range" min={0} max={100} value={Math.round(opacity * 100)} onChange={e => onTransformChange({ opacity: Number(e.target.value) / 100 })} className="w-24" />
        <span className="text-gray-400 w-8">{Math.round(opacity * 100)}%</span>
      </div>
    </div>
  );
}
