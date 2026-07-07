import { useState, useEffect, useCallback } from 'react';
import { useEditorStore } from '../../store';
import { api } from '../../services/api';
import { SkillFile, SkillRule, TransformationResult } from '../../types';

export function SkillPanel() {
  const { selectedText, selectedElementId, currentPage, document, setAIResult, applyTransformation } = useEditorStore();
  const [skills, setSkills] = useState<SkillFile[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [testResult, setTestResult] = useState<TransformationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    try {
      const result = await api.listSkills();
      setSkills(result.skills);
      if (result.skills.length > 0) {
        setSelectedSkill(result.skills[0].id);
      }
    } catch {
      setError('Failed to load skills');
    }
  };

  const handleSkillTransform = useCallback(async () => {
    if (!selectedText || !selectedSkill) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.applySkillTransform(selectedText, selectedSkill);
      setTestResult(result);
      setAIResult(result);
    } catch (err) {
      setError('Skill transformation failed');
    } finally {
      setLoading(false);
    }
  }, [selectedText, selectedSkill, setAIResult]);

  const handleSaveSkill = useCallback(async () => {
    if (!editContent) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.saveSkill(editContent, 'product-code.md');
      await loadSkills();
      setShowEditor(false);
    } catch (err) {
      setError('Failed to save skill');
    } finally {
      setLoading(false);
    }
  }, [editContent]);

  const handleLoadDefault = async () => {
    try {
      const resp = await fetch('/skills/product-code.md');
      const content = await resp.text();
      const result = await api.loadSkill(content);
      await loadSkills();
    } catch {
      setError('Failed to load default skill');
    }
  };

  const currentSkill = skills.find((s) => s.id === selectedSkill);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Skill Engine</h2>
        <div className="flex gap-1">
          <button
            className="btn-ghost p-1 rounded text-xs"
            onClick={handleLoadDefault}
          >
            Load Default
          </button>
          <button
            className="btn-ghost p-1 rounded text-xs"
            onClick={() => useEditorStore.getState().toggleSkillPanel()}
          >
            ✕
          </button>
        </div>
      </div>

      {skills.length === 0 ? (
        <div className="p-6 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">No skills loaded</p>
          <p className="text-xs text-gray-400 mt-1">
            Load the default skill from the skill file
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">
              Active Skill
            </label>
            <select
              className="input text-xs"
              value={selectedSkill || ''}
              onChange={(e) => setSelectedSkill(e.target.value)}
            >
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (v{s.version})
                </option>
              ))}
            </select>
          </div>

          {currentSkill && (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs font-medium text-gray-700">{currentSkill.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{currentSkill.description}</p>
              <p className="text-xs text-gray-400 mt-1">
                Version {currentSkill.version} · {currentSkill.rules.length} rules
              </p>
            </div>
          )}

          {currentSkill && currentSkill.rules.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Rules</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {currentSkill.rules.map((rule: SkillRule) => (
                  <div
                    key={rule.id}
                    className="p-2 bg-white rounded border border-gray-200 text-xs"
                  >
                    <p className="font-medium text-gray-700">{rule.name}</p>
                    <code className="text-gray-500 text-[10px]">{rule.pattern}</code>
                    {rule.digitShift && (
                      <span className="ml-1 text-brand-600">+{rule.digitShift}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-200 pt-3">
            <button
              className="btn-secondary w-full text-xs py-1.5"
              onClick={() => {
                setShowEditor(!showEditor);
                if (!showEditor && currentSkill) {
                  setEditContent(`# ${currentSkill.name}\n\nEdit skill content here...`);
                }
              }}
            >
              {showEditor ? 'Close Editor' : 'Edit Skill File'}
            </button>
          </div>

          {showEditor && (
            <div>
              <textarea
                className="input text-xs font-mono"
                rows={12}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="# Skill file content..."
              />
              <button
                className="btn-primary w-full text-xs py-1.5 mt-2"
                onClick={handleSaveSkill}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save Skill'}
              </button>
            </div>
          )}

          <div className="border-t border-gray-200 pt-3">
            <p className="text-xs font-medium text-gray-500 mb-1">Test Skill</p>
            {!selectedText ? (
              <p className="text-xs text-gray-400">Select text on PDF to test</p>
            ) : (
              <button
                className="btn-primary w-full text-xs py-1.5"
                onClick={handleSkillTransform}
                disabled={loading}
              >
                {loading ? 'Transforming...' : 'Apply Skill to Selected Text'}
              </button>
            )}
          </div>

          {testResult && (
            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
              <p className="text-xs font-medium text-green-700 mb-1">Result</p>
              <p className="text-xs text-green-600 font-mono whitespace-pre-wrap line-clamp-3">
                {testResult.transformed}
              </p>
              {testResult.appliedRules.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {testResult.appliedRules.map((rule, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium"
                    >
                      {rule}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  className="btn-primary flex-1 text-xs py-1.5"
                  onClick={async () => {
                    applyTransformation(testResult.transformed);
                    if (document && selectedElementId) {
                      try {
                        await api.updateElement(document.id, currentPage, selectedElementId, { content: testResult.transformed });
                      } catch { /* silent */ }
                    }
                    setTestResult(null);
                  }}
                >
                  Apply Changes
                </button>
                <button
                  className="btn-secondary text-xs py-1.5"
                  onClick={() => setTestResult(null)}
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
