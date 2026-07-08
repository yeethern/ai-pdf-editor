import { useState, useCallback } from 'react';
import { useEditorStore } from '../../store';
import { api } from '../../services/api';
import { QRCodeCoverAction } from '../../types';

export function QRPanel() {
  const { document, pushHistory, setDocument, pdfUrl } = useEditorStore();
  const [coverQR, setCoverQR] = useState(false);
  const [coverDesc, setCoverDesc] = useState(false);
  const [pageFrom, setPageFrom] = useState(1);
  const [pageTo, setPageTo] = useState(document?.metadata?.pageCount || 1);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPages = document?.metadata?.pageCount || 1;
  const qrCodes = document?.detectedQRCodes || [];

  const handleApply = useCallback(async () => {
    if (!document) return;
    setApplying(true);
    setError(null);
    setApplied(false);
    try {
      const action: QRCodeCoverAction = {
        id: crypto.randomUUID(),
        coverQR,
        coverDesc,
        color: '#ffffff',
        pageRange: { from: pageFrom, to: pageTo },
      };
      const res = await api.applyQRCodeCovers(document.id, [action]);
      pushHistory('QR code covers applied');
      setDocument(res.document, pdfUrl || undefined);
      setApplied(true);
    } catch (err: any) {
      setError(err.message || 'Apply failed');
    } finally {
      setApplying(false);
    }
  }, [document, coverQR, coverDesc, pageFrom, pageTo, pushHistory, setDocument, pdfUrl]);

  return (
    <div className="space-y-3">
      {/* QR results display */}
      {qrCodes.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          <div className="text-xs font-medium text-gray-600">
            Found {qrCodes.length} QR code{qrCodes.length !== 1 ? 's' : ''}:
          </div>
          {qrCodes.map((qr) => (
            <div key={qr.id} className="p-1.5 bg-gray-50 rounded border border-gray-200 text-xs">
              <div className="text-gray-500">
                Page {qr.page + 1} · ({qr.bbox[0]},{qr.bbox[1]}) {qr.bbox[2]}×{qr.bbox[3]}
              </div>
              <div className="font-mono text-gray-800 truncate" title={qr.content}>
                {qr.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {qrCodes.length === 0 && (
        <div className="text-xs text-gray-400 text-center py-2">
          No QR codes detected on this document
        </div>
      )}

      <hr className="border-gray-200" />

      {/* Cover QR Code checkbox */}
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={coverQR}
          onChange={(e) => setCoverQR(e.target.checked)}
          className="rounded border-gray-300"
        />
        <span className="text-gray-700">Cover QR code</span>
      </label>

      {/* Cover QR Code Desc checkbox */}
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={coverDesc}
          onChange={(e) => setCoverDesc(e.target.checked)}
          className="rounded border-gray-300"
        />
        <span className="text-gray-700">Cover QR code desc</span>
      </label>

      {/* Page range slider */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500 w-12">Pages:</span>
        <input
          type="range"
          min={1}
          max={totalPages}
          value={pageFrom}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPageFrom(Math.min(v, pageTo));
          }}
          className="w-16"
        />
        <span className="text-gray-400 w-4 text-center">{pageFrom}</span>
        <span className="text-gray-300">–</span>
        <span className="text-gray-400 w-4 text-center">{pageTo}</span>
        <input
          type="range"
          min={1}
          max={totalPages}
          value={pageTo}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPageTo(Math.max(v, pageFrom));
          }}
          className="w-16"
        />
      </div>

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {applied && (
        <div className="p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
          QR code covers applied
        </div>
      )}

      {/* Apply button */}
      <button
        className="btn-primary w-full text-xs py-1.5"
        onClick={handleApply}
        disabled={applying || !document || !coverQR}
      >
        {applying ? 'Applying...' : 'Apply QR Code Covers'}
      </button>
    </div>
  );
}