import { useState, useEffect, useCallback } from 'react';
import { useEditorStore } from '../../store';
import { api } from '../../services/api';
import { Condition, Action, StyleRule, ImageOverlay, PDFDocument } from '../../types';
import { OverlayPreviewCanvas } from './OverlayPreviewCanvas';

interface CondForm {
  field: string;
  op: string;
  value: any;
}

interface ActForm {
  field: string;
  value: any;
}

interface RuleForm {
  conditions: CondForm[];
  actions: ActForm[];
}

interface FontEntry {
  file: string | null;
  category: string;
}

const CONFIG: Record<string, { label: string; ops: { value: string; label: string }[]; valueType: string; boolOptions?: { value: string; label: string }[] }> = {
  fontSize: { label: 'fontSize', ops: [{ value: 'gt', label: '>' }, { value: 'gte', label: '≥' }, { value: 'lt', label: '<' }, { value: 'lte', label: '≤' }, { value: 'eq', label: '=' }], valueType: 'number' },
  color: { label: 'color', ops: [{ value: 'eq', label: 'is' }, { value: 'neq', label: 'is not' }], valueType: 'color' },
  font: { label: 'font', ops: [{ value: 'eq', label: 'is' }, { value: 'neq', label: 'is not' }], valueType: 'font' },
  bold: { label: 'bold', ops: [{ value: 'eq', label: 'is' }], valueType: 'bool', boolOptions: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
  italic: { label: 'italic', ops: [{ value: 'eq', label: 'is' }], valueType: 'bool', boolOptions: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
  content: { label: 'content', ops: [{ value: 'contains', label: 'contains' }, { value: 'eq', label: 'is' }, { value: 'matches', label: 'matches' }], valueType: 'text' },
  page: { label: 'page', ops: [{ value: 'eq', label: '=' }, { value: 'gt', label: '>' }, { value: 'lt', label: '<' }], valueType: 'number' },
  x: { label: 'x', ops: [{ value: 'gt', label: '>' }, { value: 'lt', label: '<' }, { value: 'gte', label: '≥' }, { value: 'lte', label: '≤' }], valueType: 'number' },
  y: { label: 'y', ops: [{ value: 'gt', label: '>' }, { value: 'lt', label: '<' }, { value: 'gte', label: '≥' }, { value: 'lte', label: '≤' }], valueType: 'number' },
};

const ACTION_CONFIG: Record<string, { label: string; valueType: string; boolOptions?: { value: string; label: string }[] }> = {
  font: { label: 'font', valueType: 'font' },
  fontSize: { label: 'fontSize', valueType: 'number' },
  color: { label: 'color', valueType: 'color' },
  bold: { label: 'bold', valueType: 'bool', boolOptions: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
  italic: { label: 'italic', valueType: 'bool', boolOptions: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
  underline: { label: 'underline', valueType: 'bool', boolOptions: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] },
  content: { label: 'content', valueType: 'text' },
};

const FIELD_NAMES = Object.keys(CONFIG);
const ACTION_NAMES = Object.keys(ACTION_CONFIG);
const CATEGORY_LABELS: Record<string, string> = {
  'sans-serif': 'Sans-Serif', serif: 'Serif', 'slab-serif': 'Slab Serif',
  mono: 'Monospace', script: 'Script',
};

function injectFontFace(family: string, ttfUrl: string) {
  const id = `hf-${family.replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `@font-face { font-family: '${family}'; src: url('${ttfUrl}') format('truetype'); }`;
  document.head.appendChild(style);
}

function FontSelect({ value, onChange, fonts }: { value: any; onChange: (v: any) => void; fonts: Record<string, FontEntry> }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<'cat' | 'font'>('cat');
  const [pickedCat, setPickedCat] = useState<string | null>(() => {
    if (!value) return null;
    return fonts[value]?.category || null;
  });

  useEffect(() => {
    for (const [family, entry] of Object.entries(fonts)) {
      if (entry.file) injectFontFace(family, `/api/fonts/${entry.file}`);
    }
  }, [fonts]);

  const byCat: Record<string, string[]> = {};
  for (const [name, entry] of Object.entries(fonts)) {
    const cat = entry.category || 'sans-serif';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(name);
  }
  for (const cat of Object.keys(byCat)) byCat[cat].sort();
  const catOrder = ['sans-serif', 'serif', 'slab-serif', 'mono'];

  const catFonts = pickedCat ? (byCat[pickedCat] || []) : [];

  const displayText = value
    ? value
    : level === 'cat'
      ? 'Font…'
      : pickedCat
        ? CATEGORY_LABELS[pickedCat] || pickedCat
        : 'Font…';

  return (
    <div className="relative">
      <button className="input text-xs w-32 text-left truncate" style={{ fontFamily: value || undefined }} onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 150)}>
        {displayText}
        <span className="float-right">▼</span>
      </button>
      {open && (
        <ul className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-gray-300 rounded shadow-lg max-h-48 overflow-y-auto text-xs">
          {level === 'cat' ? (
            <>
              <li className="px-2 py-1 hover:bg-gray-100 cursor-pointer" style={{ fontFamily: 'inherit' }} onMouseDown={() => { onChange(''); setOpen(false); setLevel('cat'); }}>None</li>
              <li className="border-b border-gray-200" />
              {catOrder.map(cat =>
                byCat[cat] && byCat[cat].length > 0 ? (
                  <li key={cat} className="px-2 py-1 hover:bg-gray-100 cursor-pointer font-medium" onMouseDown={() => { setPickedCat(cat); setLevel('font'); }}>
                    {CATEGORY_LABELS[cat] || cat}
                  </li>
                ) : null
              )}
            </>
          ) : (
            <>
              <li className="px-2 py-1 hover:bg-gray-100 cursor-pointer text-gray-500 text-center text-[10px] uppercase tracking-wider" onMouseDown={() => setLevel('cat')}>← Categories</li>
              <li className="border-b border-gray-200" />
              {catFonts.map(name => (
                <li key={name} className="px-2 py-1 hover:bg-gray-100 cursor-pointer truncate" style={{ fontFamily: name }} onMouseDown={() => { onChange(name); setOpen(false); setLevel('cat'); }}>
                  {name}
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
}

function CondValueInput({ cond, onChange, fonts }: { cond: CondForm; onChange: (v: any) => void; fonts: Record<string, FontEntry> }) {
  const cfg = CONFIG[cond.field];
  if (!cfg) return null;
  if (cfg.valueType === 'number') return <input type="number" className="input text-xs w-16" value={cond.value ?? ''} onChange={e => onChange(Number(e.target.value))} />;
  if (cfg.valueType === 'color') return <input type="color" className="w-8 h-7 p-0 border rounded cursor-pointer" value={cond.value || '#000000'} onChange={e => onChange(e.target.value)} />;
  if (cfg.valueType === 'bool') return (
    <select className="input text-xs w-16" value={String(cond.value ?? 'true')} onChange={e => onChange(e.target.value === 'true')}>
      {cfg.boolOptions?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  if (cfg.valueType === 'font') return <FontSelect fonts={fonts} value={cond.value} onChange={onChange} />;
  return <input type="text" className="input text-xs w-24" value={cond.value ?? ''} onChange={e => onChange(e.target.value)} />;
}

function ActValueInput({ act, onChange, fonts }: { act: ActForm; onChange: (v: any) => void; fonts: Record<string, FontEntry> }) {
  const cfg = ACTION_CONFIG[act.field];
  if (!cfg) return null;
  if (cfg.valueType === 'number') return <input type="number" className="input text-xs w-16" value={act.value ?? ''} onChange={e => onChange(Number(e.target.value))} />;
  if (cfg.valueType === 'color') return <input type="color" className="w-8 h-7 p-0 border rounded cursor-pointer" value={act.value || '#000000'} onChange={e => onChange(e.target.value)} />;
  if (cfg.valueType === 'bool') return (
    <select className="input text-xs w-16" value={String(act.value ?? 'true')} onChange={e => onChange(e.target.value === 'true')}>
      {cfg.boolOptions?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  if (cfg.valueType === 'font') return <FontSelect fonts={fonts} value={act.value} onChange={onChange} />;
  return <input type="text" className="input text-xs w-24" value={act.value ?? ''} onChange={e => onChange(e.target.value)} />;
}

function emptyCond(): CondForm {
  return { field: 'fontSize', op: 'gt', value: 15 };
}

function emptyAct(): ActForm {
  return { field: 'font', value: '' };
}

function emptyRule(): RuleForm {
  return { conditions: [emptyCond()], actions: [emptyAct()] };
}

export function StylePanel() {
  const { document, pdfUrl, pushHistory, markElementEdited, setDocument } = useEditorStore();
  const [activeTab, setActiveTab] = useState<'rules' | 'overlays'>('rules');

  // Rules state
  const [rules, setRules] = useState<RuleForm[]>([emptyRule()]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ matched: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fonts, setFonts] = useState<Record<string, FontEntry>>({});

  // Overlays state
  const [overlays, setOverlays] = useState<ImageOverlay[]>([]);
  const [applying, setApplying] = useState(false);
  const [overlayResult, setOverlayResult] = useState<string | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/fonts/manifest').then(r => r.json()).then(data => setFonts(data)).catch(() => {});
  }, []);

  const updateCond = (ri: number, ci: number, patch: Partial<CondForm>) => {
    setRules(prev => {
      const next = prev.map((r, i) => i === ri ? { ...r, conditions: r.conditions.map((c, j) => j === ci ? { ...c, ...patch } : c) } : r);
      return next;
    });
  };

  const updateAct = (ri: number, ai: number, patch: Partial<ActForm>) => {
    setRules(prev => {
      const next = prev.map((r, i) => i === ri ? { ...r, actions: r.actions.map((a, j) => j === ai ? { ...a, ...patch } : a) } : r);
      return next;
    });
  };

  const addCond = (ri: number) => {
    setRules(prev => prev.map((r, i) => i === ri ? { ...r, conditions: [...r.conditions, emptyCond()] } : r));
  };

  const removeCond = (ri: number, ci: number) => {
    setRules(prev => prev.map((r, i) => i === ri ? { ...r, conditions: r.conditions.filter((_, j) => j !== ci) } : r));
  };

  const addAct = (ri: number) => {
    setRules(prev => prev.map((r, i) => i === ri ? { ...r, actions: [...r.actions, emptyAct()] } : r));
  };

  const removeAct = (ri: number, ai: number) => {
    setRules(prev => prev.map((r, i) => i === ri ? { ...r, actions: r.actions.filter((_, j) => j !== ai) } : r));
  };

  const removeRule = (ri: number) => {
    setRules(prev => prev.filter((_, i) => i !== ri));
  };

  const handleApply = useCallback(async () => {
    if (!document) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const apiRules: StyleRule[] = rules.map(r => ({
        conditions: r.conditions.filter(c => c.value !== '' && c.value !== undefined),
        actions: r.actions.filter(a => a.value !== '' && a.value !== undefined),
      }));
      const res = await api.bulkStyle(document.id, apiRules);
      setResult({ matched: res.matched });
      pushHistory('Rule-based style applied');
      const { pdfUrl } = useEditorStore.getState();
      setDocument(res.document, pdfUrl || undefined);
      for (const id of res.matchedIds) {
        markElementEdited(id);
      }
    } catch (err: any) {
      setError(err.message || 'Bulk style failed');
    } finally {
      setLoading(false);
    }
  }, [document, rules, pushHistory, setDocument, markElementEdited]);

  const condOps = (field: string) => CONFIG[field]?.ops || [];

  const addOverlay = (overlay: ImageOverlay) => {
    setOverlays(prev => [...prev, overlay]);
  };

  const updateOverlay = (idx: number, patch: Partial<ImageOverlay>) => {
    setOverlays(prev => prev.map((o, i) => i === idx ? { ...o, ...patch } : o));
  };

  const removeOverlay = (idx: number) => {
    setOverlays(prev => prev.filter((_, i) => i !== idx));
  };

  const handleApplyOverlays = useCallback(async () => {
    if (!document) return;
    setApplying(true);
    setOverlayError(null);
    setOverlayResult(null);
    try {
      const res = await api.applyOverlays(document.id, overlays);
      setOverlayResult(`Applied ${overlays.length} overlay${overlays.length !== 1 ? 's' : ''}`);
      pushHistory('Image overlays applied');
      useEditorStore.getState().updateOverlays(res.document.overlays);
    } catch (err: any) {
      setOverlayError(err.message || 'Apply overlays failed');
    } finally {
      setApplying(false);
    }
  }, [document, overlays, pushHistory]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Style Editor</h2>
        <button className="btn-ghost p-1 rounded text-xs" onClick={() => useEditorStore.getState().toggleStylePanel()}>
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-3">
        <button className={`text-xs px-3 py-1.5 ${activeTab === 'rules' ? 'text-brand-600 border-b-2 border-brand-600 font-medium' : 'text-gray-500'}`} onClick={() => setActiveTab('rules')}>
          Style Rules
        </button>
        <button className={`text-xs px-3 py-1.5 ${activeTab === 'overlays' ? 'text-brand-600 border-b-2 border-brand-600 font-medium' : 'text-gray-500'}`} onClick={() => setActiveTab('overlays')}>
          Add Image Overlay
        </button>
      </div>

      {activeTab === 'rules' ? (
        <div>
          {rules.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-xs text-gray-400 mb-2">No rules defined.</p>
              <button className="btn-secondary text-xs py-1.5" onClick={() => setRules([emptyRule()])}>
                + Add Rule
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule, ri) => (
                <div key={ri} className="p-2 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-gray-600">Rule {ri + 1}</span>
                    <button className="btn-ghost p-0.5 rounded text-xs text-red-500" onClick={() => removeRule(ri)}>
                      ✕
                    </button>
                  </div>

                  <div className="space-y-1">
                    {rule.conditions.map((cond, ci) => (
                      <div key={ci} className="flex items-center gap-1 flex-wrap">
                        {ci === 0 ? (
                          <span className="text-xs text-gray-500 font-medium w-8">When</span>
                        ) : (
                          <span className="text-xs text-gray-400 ml-8">and</span>
                        )}
                        <select className="input text-xs w-20" value={cond.field} onChange={e => updateCond(ri, ci, { field: e.target.value, op: CONFIG[e.target.value]?.ops[0]?.value || 'eq', value: e.target.value === 'bold' || e.target.value === 'italic' ? true : (e.target.value === 'fontSize' ? 15 : '') })}>
                          {FIELD_NAMES.map(f => <option key={f} value={f}>{CONFIG[f].label}</option>)}
                        </select>
                        <select className="input text-xs w-14" value={cond.op} onChange={e => updateCond(ri, ci, { op: e.target.value })}>
                          {condOps(cond.field).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <CondValueInput cond={cond} onChange={v => updateCond(ri, ci, { value: v })} fonts={fonts} />
                        {rule.conditions.length > 1 && (
                          <button className="btn-ghost p-0.5 rounded text-xs text-gray-400" onClick={() => removeCond(ri, ci)}>
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    <button className="btn-ghost text-xs text-brand-600 ml-8" onClick={() => addCond(ri)}>
                      + and
                    </button>
                  </div>

                  <div className="border-t border-gray-200 my-2" />

                  <div className="space-y-1">
                    {rule.actions.map((act, ai) => (
                      <div key={ai} className="flex items-center gap-1 flex-wrap">
                        {ai === 0 ? (
                          <span className="text-xs text-gray-500 font-medium w-8">Then</span>
                        ) : (
                          <span className="text-xs text-gray-400 ml-8">and</span>
                        )}
                        <span className="text-xs text-gray-400">set</span>
                        <select className="input text-xs w-20" value={act.field} onChange={e => updateAct(ri, ai, { field: e.target.value, value: e.target.value === 'bold' || e.target.value === 'italic' || e.target.value === 'underline' ? true : (e.target.value === 'fontSize' ? 12 : '') })}>
                          {ACTION_NAMES.map(f => <option key={f} value={f}>{ACTION_CONFIG[f].label}</option>)}
                        </select>
                        <span className="text-xs text-gray-400">to</span>
                        <ActValueInput act={act} onChange={v => updateAct(ri, ai, { value: v })} fonts={fonts} />
                        {rule.actions.length > 1 && (
                          <button className="btn-ghost p-0.5 rounded text-xs text-gray-400" onClick={() => removeAct(ri, ai)}>
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    <button className="btn-ghost text-xs text-brand-600 ml-8" onClick={() => addAct(ri)}>
                      + and
                    </button>
                  </div>
                </div>
              ))}

              <button className="btn-secondary w-full text-xs py-1.5" onClick={() => setRules(prev => [...prev, emptyRule()])}>
                + Add Rule
              </button>

              {result && (
                <div className="p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                  Applied — {result.matched} element{result.matched !== 1 ? 's' : ''} changed
                </div>
              )}

              {error && (
                <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                  {error}
                </div>
              )}

              <button
                className="btn-primary w-full text-xs py-1.5"
                onClick={handleApply}
                disabled={loading || !document}
              >
                {loading ? 'Applying...' : 'Apply Changes'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {overlays.map((overlay, idx) => (
            <div key={overlay.id} className="p-2 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-600">Overlay {idx + 1}</span>
                <button className="btn-ghost p-0.5 rounded text-xs text-red-500" onClick={() => removeOverlay(idx)}>
                  ✕
                </button>
              </div>
              <OverlayItem
                overlay={overlay}
                idx={idx}
                pdfUrl={pdfUrl}
                document={document}
                onUpdate={(patch) => updateOverlay(idx, patch)}
                onDelete={() => removeOverlay(idx)}
              />
            </div>
          ))}
          <button className="btn-secondary w-full text-xs py-1.5" onClick={() => addOverlay(emptyOverlay(pdfUrl, document))}>
            + Add Overlay
          </button>
          {overlayResult && (
            <div className="p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
              {overlayResult}
            </div>
          )}
          {overlayError && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {overlayError}
            </div>
          )}
          <button
            className="btn-primary w-full text-xs py-1.5"
            onClick={handleApplyOverlays}
            disabled={applying || !document || overlays.length === 0}
          >
            {applying ? 'Applying...' : 'Apply Overlays'}
          </button>
        </div>
      )}
    </div>
  );
}

function emptyOverlay(pdfUrl: string | null, doc: PDFDocument | null): ImageOverlay {
  const pageW = doc?.pages?.[0]?.width || 612;
  const pageH = doc?.pages?.[0]?.height || 792;
  return {
    id: crypto.randomUUID(),
    imageUrl: '',
    x: (pageW - 200) / 2,
    y: (pageH - 200) / 2,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    pageRange: { from: 1, to: doc?.metadata?.pageCount || 1 },
  };
}

function OverlayItem({ overlay, idx, pdfUrl, document, onUpdate, onDelete }: {
  overlay: ImageOverlay;
  idx: number;
  pdfUrl: string | null;
  document: PDFDocument | null;
  onUpdate: (patch: Partial<ImageOverlay>) => void;
  onDelete: () => void;
}) {
  const [previewPage, setPreviewPage] = useState(0);
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.uploadImage(file);
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const maxDim = 500;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const pageW = document?.pages?.[0]?.width || 612;
        const pageH = document?.pages?.[0]?.height || 792;
        onUpdate({
          imageUrl: res.url,
          width: w,
          height: h,
          x: (pageW - w) / 2,
          y: (pageH - h) / 2,
        });
      };
      img.src = res.url;
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploading(false);
    }
  }, [onUpdate, document]);

  if (!overlay.imageUrl) {
    return (
      <div className="text-xs text-center py-4">
        <label className="btn-secondary text-xs py-1 px-3 cursor-pointer inline-block">
          {uploading ? 'Uploading...' : 'Choose Image'}
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
    );
  }

  const pageW = document?.pages?.[previewPage]?.width || 612;
  const pageH = document?.pages?.[previewPage]?.height || 792;
  const totalPages = document?.metadata?.pageCount || 1;
  const pageImageUrl = pdfUrl ? `${pdfUrl}/page/${previewPage + 1}.png` : null;

  return (
    <OverlayPreviewCanvas
      pageImageUrl={pageImageUrl}
      pageWidth={pageW}
      pageHeight={pageH}
      overlayImageUrl={overlay.imageUrl}
      x={overlay.x}
      y={overlay.y}
      width={overlay.width}
      height={overlay.height}
      rotation={overlay.rotation}
      opacity={overlay.opacity}
      pageRange={overlay.pageRange}
      totalPages={totalPages}
      previewPage={previewPage}
      onTransformChange={(patch) => onUpdate(patch)}
      onPageRangeChange={(r) => onUpdate({ pageRange: r })}
      onPageChange={setPreviewPage}
      onDelete={onDelete}
    />
  );
}
