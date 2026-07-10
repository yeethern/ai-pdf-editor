import { useState, useCallback, useEffect } from 'react';
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
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!document) return;
    setLoading(true);
    api.getDocument(document.id)
      .then((res) => {
        if (res.document) {
          setDocument(res.document, pdfUrl || undefined);
        }
      })
      .catch((err) => console.error('Failed to load document:', err))
      .finally(() => setLoading(false));
  }, [document?.id, setDocument, pdfUrl]);

  const totalPages = document?.metadata?.pageCount || 1;
  const qrCodes = document?.detectedQRCodes || [];

  const handleDetectQR = useCallback(async () => {
    if (!document) return;
    setScanning(true);
    setError(null);
    setApplied(false);
    try {
      const allPages = Array.from({ length: totalPages }, (_, i) => i);
      await api.detectQRCodes(document.id, allPages);
      const res = await api.getDocument(document.id);
      if (res.document) {
        setDocument(res.document, pdfUrl || undefined);
      }
    } catch (err: any) {
      setError(err.message || 'QR detection failed');
    } finally {
      setScanning(false);
    }
  }, [document, totalPages, setDocument, pdfUrl]);

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
      {/* Scan Button at the top */}
      <div className="flex gap-2">
        <button
          className="btn-secondary w-full text-xs py-1.5 flex items-center justify-center gap-1.5"
          onClick={handleDetectQR}
          disabled={scanning || loading || !document}
        >
          {scanning ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Scanning document...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Scan for QR Codes
            </>
          )}
        </button>
      </div>

      {/* QR results display */}
      {qrCodes.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto pt-2 border-t border-gray-150">
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
        <div className="text-xs text-gray-400 text-center py-2 border-t border-gray-150">
          {loading ? 'Syncing...' : 'No QR codes detected on this document.'}
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