import { useState, useCallback, useEffect } from 'react';
import { useEditorStore } from '../../store';
import { Toolbar } from '../Toolbar/Toolbar';
import { PDFViewer } from '../PDFViewer/PDFViewer';
import { AIPanel } from '../AIPanel/AIPanel';
import { SkillPanel } from '../SkillPanel/SkillPanel';
import { StylePanel } from '../StylePanel/StylePanel';
import { api } from '../../services/api';
import { PDFDocument } from '../../types';

function formatRelativeTime(dateStr: string) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.round(diffMs / 60000);
    const diffHours = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'Recently';
  }
}

function UploadScreen({ onUpload }: { onUpload: (doc: PDFDocument, pdfUrl?: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [recentDocs, setRecentDocs] = useState<Array<{ id: string; name: string; pageCount: number; updated: string }>>([]);

  const loadRecentDocs = useCallback(() => {
    api.listDocuments()
      .then(res => {
        const sorted = (res.documents as any[] || []).sort((a, b) => 
          new Date(b.updated).getTime() - new Date(a.updated).getTime()
        );
        setRecentDocs(sorted);
      })
      .catch(err => {
        console.error('Failed to load recent documents:', err);
      });
  }, []);

  useEffect(() => {
    loadRecentDocs();
  }, [loadRecentDocs]);

  const handleShutdown = useCallback(async () => {
    setShuttingDown(true);
    try {
      await fetch(`${import.meta.env.VITE_API_URL || '/api'}/shutdown`, { method: 'POST' });
    } catch {
      window.close();
    }
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      setError('Please upload a PDF file');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.uploadPDF(file);
      console.log('📄 PDF loaded:', result.document.name, `(${result.document.metadata?.pageCount || '?'} pages)`);
      for (let p = 0; p < (result.document.pages?.length || 0); p++) {
        const els = result.document.pages[p]?.elements || [];
        console.log(`  Page ${p + 1}: ${els.length} elements`);
      }
      if (result.usage) {
        console.log(`🧠 AI parsing — in=${result.usage.prompt} cached=${result.usage.cached} out=${result.usage.output} tot=${result.usage.total}`);
      }
      onUpload(result.document, result.pdfUrl);
    } catch (err) {
      setError('Failed to upload PDF. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }, [onUpload]);

  const handleLoadDoc = useCallback(async (docId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDocument(docId);
      onUpload(res.document, `/api/pdf/file/${res.document.id}`);
    } catch (err) {
      setError('Failed to load project. The project files may no longer exist.');
    } finally {
      setLoading(false);
    }
  }, [onUpload]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">AI PDF Editor</h1>
          <p className="text-sm text-gray-500 mt-1">Intelligent document transformation</p>
        </div>

        <div
          className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${
            dragOver
              ? 'border-brand-400 bg-brand-50 shadow-inner scale-[0.99]'
              : 'border-gray-300 hover:border-gray-400 bg-white hover:shadow-sm'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        >
          <input
            type="file"
            accept=".pdf"
            className="hidden"
            id="pdf-upload"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            disabled={loading}
          />
          <label htmlFor="pdf-upload" className={loading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}>
            <svg className="w-10 h-10 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-gray-700">
              {loading ? 'Processing...' : 'Drop PDF here or click to browse'}
            </p>
            <p className="text-xs text-gray-400 mt-1">PDF files up to 50MB</p>
          </label>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {recentDocs.length > 0 && (
          <div className="mt-8 pt-8 border-t border-gray-200">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-left mb-3.5">
              Recent Projects
            </h2>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {recentDocs.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => handleLoadDoc(doc.id)}
                  disabled={loading}
                  className="w-full flex items-center justify-between p-3.5 bg-white border border-gray-200 hover:border-brand-300 rounded-xl hover:shadow-sm transition-all text-left group disabled:opacity-60 disabled:pointer-events-none"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 bg-brand-50 group-hover:bg-brand-100 rounded-lg flex items-center justify-center shrink-0 transition-colors">
                      <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-brand-700 transition-colors">
                        {doc.name}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {doc.pageCount} pages • {formatRelativeTime(doc.updated)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-medium text-brand-600 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                    Open
                    <svg className="w-3.5 h-3.5 transform group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 text-center">
          <button
            onClick={handleShutdown}
            disabled={shuttingDown}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {shuttingDown ? 'Stopping...' : 'Stop Server'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const document = useEditorStore((s) => s.document);
  const setDocument = useEditorStore((s) => s.setDocument);
  const showAIPanel = useEditorStore((s) => s.showAIPanel);
  const showSkillPanel = useEditorStore((s) => s.showSkillPanel);
  const showStylePanel = useEditorStore((s) => s.showStylePanel);
  const setSaveStatus = useEditorStore((s) => s.setSaveStatus);

  useEffect(() => {
    if (!document) return;

    setSaveStatus('saving');

    const timer = setTimeout(() => {
      api.saveDocument(document)
        .then(() => {
          setSaveStatus('saved');
        })
        .catch((err) => {
          console.error('❌ Auto-save failed:', err);
          setSaveStatus('error');
        });
    }, 1500);

    return () => clearTimeout(timer);
  }, [document, setSaveStatus]);

  if (!document) {
    return <UploadScreen onUpload={setDocument} />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Toolbar />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative min-w-0">
          <PDFViewer />
        </div>
        {showAIPanel && (
          <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
            <AIPanel />
          </div>
        )}
        {showSkillPanel && (
          <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
            <SkillPanel />
          </div>
        )}
        {showStylePanel && (
          <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
            <StylePanel />
          </div>
        )}
      </div>
    </div>
  );
}
