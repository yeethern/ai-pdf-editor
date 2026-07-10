import { useState, useEffect, useMemo, useCallback } from 'react';
import { useEditorStore } from '../../store';
import { TextElement } from '../../types';

interface ParsedCode {
  segments: string[];
  textElementId: string;
}

interface Segment {
  id: string;
  originalIndex: number | null;
  prefix: string;
  values: string[];
  isFixed: boolean;
  replacement: string;
  perValueReps: Record<string, string>;
  separator: string;
}

function findCommonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  let prefix = values[0];
  for (const v of values.slice(1)) {
    while (!v.startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
}

function shiftDigits(str: string, shift: number): string {
  return str.replace(/\d/g, d => String((parseInt(d) + shift) % 10));
}

interface TableData {
  id: number;
  codes: ParsedCode[];
  segments: Segment[];
}

const X_TOLERANCE = 15;
const COL_HEADER_RE = /code|product|part|item|no/i;
const PREVIEW_SAMPLES = 2;

function findProductCodeColumn(elements: TextElement[]): TextElement[] | null {
  const cx = (el: TextElement) => el.bbox[0] + el.bbox[2] / 2;
  const sorted = [...elements].sort((a, b) => cx(a) - cx(b));
  const columns: TextElement[][] = [];
  for (const el of sorted) {
    const col = columns.find(c => Math.abs(cx(c[0]) - cx(el)) < X_TOLERANCE);
    if (col) col.push(el);
    else columns.push([el]);
  }
  for (const col of columns) {
    col.sort((a, b) => a.bbox[1] - b.bbox[1]);
  }
  for (const col of columns) {
    const header = col[0]?.content?.trim();
    if (header && COL_HEADER_RE.test(header)) {
      return col;
    }
  }
  return null;
}

function parseCodes(els: TextElement[]): ParsedCode[] {
  const result: ParsedCode[] = [];
  for (const el of els) {
    const content = (el.content ?? '').trim();
    if (!content.includes('-') || content.length < 5) continue;
    const segs = content.split('-').map(s => s.trim()).filter(Boolean);
    if (segs.length >= 2) {
      result.push({ segments: segs, textElementId: el.id });
    }
  }
  return result;
}

function buildSegments(codes: ParsedCode[]): Segment[] {
  if (codes.length === 0) return [];
  const maxLen = Math.max(...codes.map(c => c.segments.length));
  const segs: Segment[] = [];
  for (let i = 0; i < maxLen; i++) {
    const vals = codes.filter(c => c.segments.length > i).map(c => c.segments[i]);
    const unique = [...new Set(vals)];
    const isFixed = unique.every(v => v === unique[0]);
    const perValueReps: Record<string, string> = {};
    for (const v of unique) perValueReps[v] = v;
    segs.push({
      id: crypto.randomUUID(),
      originalIndex: i,
      prefix: '',
      values: unique,
      isFixed,
      replacement: isFixed ? unique[0] : '',
      perValueReps,
      separator: i < maxLen - 1 ? '-' : '',
    });
  }

  const refined: Segment[] = [];
  for (const seg of segs) {
    if (!seg.isFixed && seg.values.length > 1 && seg.values[0].length >= 5) {
      const cp = findCommonPrefix(seg.values);
      if (cp.length >= 3) {
        const remainders = seg.values.map(v => v.slice(cp.length));
        const uniqueRems = [...new Set(remainders)];
        const remPerValueReps: Record<string, string> = {};
        for (const r of uniqueRems) remPerValueReps[r] = r;
        refined.push({
          id: crypto.randomUUID(),
          originalIndex: null,
          prefix: '',
          values: [cp],
          isFixed: true,
          replacement: cp,
          perValueReps: {},
          separator: '',
        });
        refined.push({
          id: crypto.randomUUID(),
          originalIndex: seg.originalIndex,
          prefix: cp,
          values: uniqueRems,
          isFixed: uniqueRems.length === 1,
          replacement: uniqueRems.length === 1 ? uniqueRems[0] : '',
          perValueReps: remPerValueReps,
          separator: seg.separator,
        });
        continue;
      }
    }
    refined.push(seg);
  }
  return refined;
}

export function ProductCodeEditor() {
  const { document, currentPage, updateElement, pushHistory, markElementEdited } = useEditorStore();

  const [tables, setTables] = useState<TableData[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedVals, setExpandedVals] = useState<Record<string, boolean>>({});
  const [usedPlusTwo, setUsedPlusTwo] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!document) return;
    const page = document.pages[currentPage];
    if (!page) return;

    const textEls = page.elements.filter((e): e is TextElement => e.type === 'text' && !!e.isTable);
    if (textEls.length === 0) {
      setTables([]);
      setActiveIndex(0);
      setApplied(false);
      return;
    }

    const byGroup = new Map<number, TextElement[]>();
    for (const el of textEls) {
      const g = el.groupIndex ?? -1;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(el);
    }

    const parsed: TableData[] = [];
    for (const [gid, els] of byGroup) {
      const col = findProductCodeColumn(els);
      if (!col || col.length <= 1) continue;
      const codes = parseCodes(col.slice(1));
      if (codes.length === 0) continue;
      parsed.push({ id: gid, codes, segments: buildSegments(codes) });
    }

    setTables(parsed);
    setActiveIndex(0);
    setApplied(false);
  }, [document, currentPage]);

  const activeTable = tables[activeIndex] ?? null;
  const segments = activeTable?.segments ?? [];

  const moveSegment = useCallback((index: number, direction: -1 | 1) => {
    setTables(prev => {
      const next = [...prev];
      const t = { ...next[activeIndex] };
      const s = [...t.segments];
      const target = index + direction;
      if (target < 0 || target >= s.length) return prev;
      [s[index], s[target]] = [s[target], s[index]];
      t.segments = s;
      next[activeIndex] = t;
      return next;
    });
  }, [activeIndex]);

  const addSegment = useCallback((afterIndex: number) => {
    setTables(prev => {
      const next = [...prev];
      const t = { ...next[activeIndex] };
      const s = [...t.segments];
      s.splice(afterIndex + 1, 0, {
        id: crypto.randomUUID(),
        originalIndex: null,
        prefix: '',
        values: [],
        isFixed: true,
        replacement: '',
        perValueReps: {},
        separator: '-',
      });
      t.segments = s;
      next[activeIndex] = t;
      return next;
    });
  }, [activeIndex]);

  const removeSegment = useCallback((index: number) => {
    setTables(prev => {
      const next = [...prev];
      const t = { ...next[activeIndex] };
      const s = [...t.segments];
      s.splice(index, 1);
      if (s.length > 0 && index > 0 && s[index - 1]) {
        s[index - 1].separator = index < t.segments.length ? t.segments[index].separator : '';
      }
      t.segments = s;
      next[activeIndex] = t;
      return next;
    });
  }, [activeIndex]);

  const updateSegment = useCallback((index: number, patch: Partial<Segment>) => {
    setTables(prev => {
      const next = [...prev];
      const t = { ...next[activeIndex] };
      const s = [...t.segments];
      s[index] = { ...s[index], ...patch };
      t.segments = s;
      next[activeIndex] = t;
      return next;
    });
  }, [activeIndex]);

  const transform = useCallback((originalSegments: string[], segs: Segment[]): string => {
    const parts = segs.map(seg => {
      if (seg.originalIndex === null) return seg.replacement || '';
      const rawVal = originalSegments[seg.originalIndex] ?? '';
      const origVal = seg.prefix && rawVal.startsWith(seg.prefix) ? rawVal.slice(seg.prefix.length) : rawVal;
      if (seg.isFixed) {
        if (seg.replacement !== '' && seg.replacement !== origVal) return seg.replacement;
        return origVal;
      }
      const rep = seg.perValueReps[origVal];
      if (rep !== undefined && rep !== '' && rep !== origVal) return rep;
      return origVal;
    });
    return parts.map((part, i) => {
      return part + (i < parts.length - 1 ? segs[i].separator : '');
    }).join('');
  }, []);

  const previewItems = useMemo(() => {
    if (!activeTable) return [];
    const items: { original: string; transformed: string }[] = [];
    for (let i = 0; i < Math.min(activeTable.codes.length, PREVIEW_SAMPLES); i++) {
      const c = activeTable.codes[i];
      items.push({
        original: c.segments.join('-'),
        transformed: transform(c.segments, activeTable.segments),
      });
    }
    return items;
  }, [activeTable, transform]);

  const handleApply = () => {
    if (!activeTable || !document) return;
    pushHistory('Batch product code update');
    setApplying(true);

    const updates: { elId: string; content: string }[] = [];
    const seen = new Set<string>();

    for (const c of activeTable.codes) {
      const oldFull = c.segments.join('-');
      const key = `${c.textElementId}:${oldFull}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const el = document.pages[currentPage].elements.find(e => e.id === c.textElementId);
      if (!el || el.type !== 'text') continue;
      const newContent = transform(c.segments, activeTable.segments);
      const oldContent = (el as any).content as string;
      const updated = oldContent.replace(oldFull, newContent);
      if (updated !== oldContent) {
        updates.push({ elId: c.textElementId, content: updated });
      }
    }

    for (const u of updates) {
      updateElement(currentPage, u.elId, { content: u.content });
      markElementEdited(u.elId);
    }

    setApplying(false);
    setApplied(true);
  };

  const hasData = tables.length > 0;

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-gray-700 mb-1">Batch Edit Product Codes</div>

      {!hasData && (
        <div className="text-xs text-gray-400 p-3 text-center">No product codes found on this page.</div>
      )}

      {hasData && (
        <>
          {/* Table tabs */}
          <div className="flex gap-0.5 flex-wrap">
            {tables.map((t, i) => (
              <button
                key={t.id}
                className={`text-xs px-2.5 py-1.5 rounded ${i === activeIndex ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                onClick={() => { setActiveIndex(i); setApplied(false); }}
              >
                Table {i + 1}
                <span className="ml-1 text-[10px] opacity-70">({t.codes.length})</span>
              </button>
            ))}
          </div>

          {/* Segment editor */}
          {activeTable && (
            <div className="space-y-2 p-2 bg-gray-50 rounded border border-gray-200 max-h-96 overflow-y-auto">
              {activeTable.segments.map((seg, i) => (
                <div key={seg.id} className="p-2 bg-white border border-gray-200 rounded-md shadow-sm space-y-2 relative">
                  {/* Line 1: Meta, Original Value, Mode, Separator, Delete */}
                  <div className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="flex flex-col flex-shrink-0">
                        <button className="text-gray-400 hover:text-gray-700 leading-none p-0 text-[10px]" onClick={() => moveSegment(i, -1)} disabled={i === 0}>▲</button>
                        <button className="text-gray-400 hover:text-gray-700 leading-none p-0 text-[10px]" onClick={() => moveSegment(i, 1)} disabled={i === segments.length - 1}>▼</button>
                      </div>
                      <span className="font-mono text-gray-800 font-semibold truncate" title={seg.values.join(', ')}>
                        {seg.values.join('/')}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${seg.isFixed ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-gray-150 border-gray-300 text-gray-600'}`}
                        onClick={() => updateSegment(i, { isFixed: !seg.isFixed })}
                      >
                        {seg.isFixed ? 'Fixed' : 'Variable'}
                      </button>

                      {i < segments.length - 1 && (
                        <select
                          className="input text-[10px] py-0.5 px-1 w-14"
                          value={seg.separator}
                          onChange={e => updateSegment(i, { separator: e.target.value })}
                        >
                          <option value="-">-</option>
                          <option value=" ">space</option>
                          <option value="">none</option>
                        </select>
                      )}

                      <button className="text-gray-400 hover:text-red-500 p-0.5 text-sm" onClick={() => removeSegment(i)}>✕</button>
                    </div>
                  </div>

                  {/* Line 2: Replacement input or Variable values expander */}
                  <div className="pl-4 flex items-center gap-1.5 text-xs">
                    <span className="text-gray-300 flex-shrink-0">→</span>
                    {seg.isFixed ? (
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <input
                          className="input flex-1 min-w-0 text-xs font-mono py-0.5 px-1.5 border border-gray-300 rounded"
                          value={seg.replacement}
                          placeholder={seg.values[0] || ''}
                          onChange={e => updateSegment(i, { replacement: e.target.value })}
                        />
                        {/\d/.test(seg.replacement || seg.values[0] || '') && !usedPlusTwo.has(seg.id) && (
                          <button
                            className="text-[10px] bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 px-1 py-0.5 rounded font-bold whitespace-nowrap"
                            onClick={() => {
                              updateSegment(i, { replacement: shiftDigits(seg.replacement || seg.values[0] || '', 2) });
                              setUsedPlusTwo(prev => new Set(prev).add(seg.id));
                            }}
                            title="Shift all digits by +2 (mod 10)"
                          >
                            +2
                          </button>
                        )}
                        {seg.values[0]?.includes('ECO') && (
                          <button
                            className="text-[10px] bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 px-1 py-0.5 rounded font-bold whitespace-nowrap"
                            onClick={() => updateSegment(i, { replacement: (seg.replacement || seg.values[0] || '').replace(/^ECO(\d+)$/, 'TC-$1').replace(/^ECO$/, 'TC') })}
                            title="Replace ECO prefix with TC"
                          >
                            ECO→TC
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col flex-1 gap-1">
                        <button
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium text-left"
                          onClick={() => setExpandedVals(prev => ({ ...prev, [seg.id]: !prev[seg.id] }))}
                        >
                          {expandedVals[seg.id] ? 'Hide' : 'Show'} [{seg.values.length} values]
                        </button>
                        {expandedVals[seg.id] && (
                          <div className="flex flex-col gap-1.5 w-full bg-gray-50 border border-gray-200 rounded p-1.5 mt-1">
                            {Object.entries(seg.perValueReps).map(([val, rep]) => (
                              <div key={val} className="flex items-center gap-1.5 justify-between text-[11px]">
                                <span className="font-mono text-gray-600 truncate max-w-[100px]" title={val}>{val}</span>
                                <span className="text-gray-300">→</span>
                                <input
                                  className="input w-28 text-xs font-mono py-0.5 px-1 border border-gray-300 rounded"
                                  value={rep}
                                  onChange={e => updateSegment(i, {
                                    perValueReps: { ...seg.perValueReps, [val]: e.target.value }
                                  })}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {i < segments.length - 1 && (
                    <div className="flex justify-center -mb-2 mt-1">
                      <button
                        className="bg-white border border-gray-200 hover:border-gray-400 text-gray-400 hover:text-gray-700 text-[10px] w-4 h-4 rounded-full flex items-center justify-center shadow-sm z-10"
                        onClick={() => addSegment(i)}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Preview */}
          {activeTable && previewItems.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Preview</div>
              <div className="space-y-0.5 border border-gray-200 rounded p-1.5 bg-white max-h-32 overflow-y-auto">
                {previewItems.map((item, i) => (
                  <div key={i} className="text-[11px] font-mono leading-relaxed flex items-center gap-1">
                    <span className="text-gray-500 line-through">{item.original}</span>
                    <span className="text-gray-300 mx-0.5">→</span>
                    <span className="text-green-700 font-semibold">{item.transformed}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Apply button */}
          {activeTable && (
            <button
              className="btn-primary text-xs py-1.5 w-full"
              disabled={applying || activeTable.codes.length === 0}
              onClick={handleApply}
            >
              {applying ? 'Applying...' : applied ? 'Applied ✓' : `Apply to ${activeTable.codes.length} code${activeTable.codes.length !== 1 ? 's' : ''}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
