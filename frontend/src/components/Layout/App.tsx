import { useState, useCallback } from 'react';
import { useEditorStore } from '../../store';
import { Toolbar } from '../Toolbar/Toolbar';
import { PDFViewer } from '../PDFViewer/PDFViewer';
import { AIPanel } from '../AIPanel/AIPanel';
import { SkillPanel } from '../SkillPanel/SkillPanel';
import { StylePanel } from '../StylePanel/StylePanel';
import { api } from '../../services/api';
import { PDFDocument } from '../../types';

function UploadScreen({ onUpload }: { onUpload: (doc: PDFDocument, pdfUrl?: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

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

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="w-full max-w-md p-8">
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
          className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragOver
              ? 'border-brand-400 bg-brand-50'
              : 'border-gray-300 hover:border-gray-400 bg-white'
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
          />
          <label htmlFor="pdf-upload" className="cursor-pointer">
            <svg className="w-10 h-10 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm font-medium text-gray-700">
              {loading ? 'Uploading...' : 'Drop PDF here or click to browse'}
            </p>
            <p className="text-xs text-gray-400 mt-1">PDF files up to 50MB</p>
          </label>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}
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

  if (!document) {
    return <UploadScreen onUpload={setDocument} />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Toolbar />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
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
