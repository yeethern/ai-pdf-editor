import { useState, useCallback } from 'react';
import { useEditorStore } from '../../store';
import { api } from '../../services/api';
import { EntityDetection } from '../../types';

export function AIPanel() {
  const {
    selectedText,
    selectedElementId,
    currentPage,
    document,
    aiResult,
    setAIResult,
    applyTransformation,
    updateElement,
  } = useEditorStore();

  const [loading, setLoading] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDetect = useCallback(async () => {
    if (!selectedText) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.transformText(selectedText);
      setAIResult(result);
      setShowDiff(true);
    } catch (err) {
      setError('Transformation failed');
    } finally {
      setLoading(false);
    }
  }, [selectedText, setAIResult]);

  const handleAnalyze = useCallback(async () => {
    if (!selectedText) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.analyzeText(selectedText);
      setAnalysis(result.summary);
    } catch (err) {
      setError('Analysis failed');
    } finally {
      setLoading(false);
    }
  }, [selectedText]);

  const handleApply = useCallback(async () => {
    if (!aiResult) return;
    applyTransformation(aiResult.transformed);
    // Persist to backend
    if (document && selectedElementId) {
      try {
        await api.updateElement(document.id, currentPage, selectedElementId, { content: aiResult.transformed });
      } catch { /* silent — in-memory state is already updated */ }
    }
    setShowDiff(false);
    setAIResult(null);
  }, [aiResult, applyTransformation, document, selectedElementId, currentPage, setAIResult]);

  const handleReject = useCallback(() => {
    setShowDiff(false);
    setAIResult(null);
  }, [setAIResult]);

  const handleCustomTransform = useCallback(async () => {
    if (!selectedText) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.transformText(selectedText, undefined, instruction);
      setAIResult(result);
      setShowDiff(true);
    } catch (err) {
      setError('Transformation failed');
    } finally {
      setLoading(false);
    }
  }, [selectedText, instruction]);

  const renderDiff = (original: string, transformed: string) => {
    if (original === transformed) {
      return (
        <div className="p-3 bg-green-50 rounded-lg border border-green-200">
          <p className="text-sm text-green-700 font-medium">No changes needed</p>
          <p className="text-xs text-green-600 mt-1">Text is already in the correct format</p>
        </div>
      );
    }

    const origWords = original.split(/(\s+)/);
    const transWords = transformed.split(/(\s+)/);

    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Original</p>
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-700 whitespace-pre-wrap font-mono">{original}</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Transformed</p>
          <div className="p-3 bg-green-50 rounded-lg border border-green-200">
            <p className="text-sm text-green-800 whitespace-pre-wrap font-mono">{transformed}</p>
          </div>
        </div>
        {aiResult && aiResult.entities.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">
              Detected Entities ({aiResult.entities.length})
            </p>
            <div className="space-y-1">
              {aiResult.entities.map((entity: EntityDetection, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 bg-yellow-50 rounded border border-yellow-200 text-xs"
                >
                  <span className="font-mono font-medium text-yellow-800">{entity.entity}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-mono text-green-700">
                    {entity.suggestedTransformation || '(no change)'}
                  </span>
                  <span className="ml-auto text-gray-400">
                    {(entity.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {aiResult && aiResult.appliedRules.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Applied Rules</p>
            <div className="flex flex-wrap gap-1">
              {aiResult.appliedRules.map((rule: string, i: number) => (
                <span
                  key={i}
                  className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded text-xs font-medium"
                >
                  {rule}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">AI Transformation</h2>
        <button
          className="btn-ghost p-1 rounded text-xs"
          onClick={() => useEditorStore.getState().toggleAIPanel()}
        >
          ✕
        </button>
      </div>

      {!selectedText ? (
        <div className="p-6 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">Select text on the PDF to transform</p>
          <p className="text-xs text-gray-400 mt-1">Click any text block to select it</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Selected Text</p>
            <div className="p-2 bg-gray-50 rounded border border-gray-200 max-h-24 overflow-y-auto">
              <p className="text-xs text-gray-700 font-mono whitespace-pre-wrap">{selectedText}</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="btn-primary flex-1 text-xs py-1.5"
              onClick={handleDetect}
              disabled={loading}
            >
              {loading ? 'Processing...' : 'Detect & Transform'}
            </button>
            <button
              className="btn-secondary text-xs py-1.5"
              onClick={handleAnalyze}
              disabled={loading}
            >
              Analyze
            </button>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Custom Instruction</p>
            <div className="flex gap-2">
              <input
                type="text"
                className="input flex-1 text-xs"
                placeholder="e.g., convert to uppercase..."
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomTransform();
                }}
              />
              <button
                className="btn-secondary text-xs py-1.5"
                onClick={handleCustomTransform}
                disabled={loading || !instruction}
              >
                Go
              </button>
            </div>
          </div>

          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {error}
            </div>
          )}

          {analysis && (
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-xs font-medium text-blue-700 mb-1">Analysis</p>
              <p className="text-xs text-blue-600">{analysis}</p>
            </div>
          )}

          {showDiff && aiResult && (
            <div className="border-t border-gray-200 pt-3 mt-3">
              {renderDiff(aiResult.original, aiResult.transformed)}

              <div className="flex gap-2 mt-3">
                <button
                  className="btn-primary flex-1 text-xs py-1.5"
                  onClick={handleApply}
                >
                  Apply Changes
                </button>
                <button
                  className="btn-secondary text-xs py-1.5"
                  onClick={handleReject}
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
