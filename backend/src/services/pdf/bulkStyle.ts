import { renderPage } from './renderer';
import { getOriginalPath, updateElement, loadDocument, saveDocument } from './parser';
import { extractElementColor } from './colors';
import { PDFDocument, TextElement, Condition, Action, StyleRule } from '../../types';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return match ? {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  } : { r: 0, g: 0, b: 0 };
}

function colorDistance(a: string, b: string): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return Math.sqrt((ca.r - cb.r) ** 2 + (ca.g - cb.g) ** 2 + (ca.b - cb.b) ** 2);
}

function evaluateCondition(
  condition: Condition,
  element: TextElement,
  colorCache?: Map<string, string>
): boolean {
  const { field, op, value } = condition;

  let actual: any;
  switch (field) {
    case 'font':
      actual = element.font;
      break;
    case 'fontSize':
      actual = element.fontSize;
      break;
    case 'color':
      actual = colorCache?.get(element.id) || (element as any).style?.color;
      break;
    case 'bold':
      actual = element.style?.bold;
      break;
    case 'italic':
      actual = element.style?.italic;
      break;
    case 'content':
      actual = element.content;
      break;
    case 'page':
      actual = element.page;
      break;
    case 'x':
      actual = element.bbox[0];
      break;
    case 'y':
      actual = element.bbox[1];
      break;
    default:
      return false;
  }

  if (actual === undefined || actual === null) return false;

  switch (op) {
    case 'eq':
      if (field === 'color') {
        const extracted = colorCache?.get(element.id) || (element as any).style?.color;
        if (!extracted) return false;
        return colorDistance(extracted, String(value)) < 40;
      }
      if (field === 'font') {
        return String(actual).toLowerCase() === String(value).toLowerCase();
      }
      return actual == value;
    case 'neq':
      if (field === 'color') {
        const extracted = colorCache?.get(element.id) || (element as any).style?.color;
        if (!extracted) return true;
        return colorDistance(extracted, String(value)) >= 40;
      }
      if (field === 'font') {
        return String(actual).toLowerCase() !== String(value).toLowerCase();
      }
      return actual != value;
    case 'gt':
      return typeof actual === 'number' && actual > Number(value);
    case 'gte':
      return typeof actual === 'number' && actual >= Number(value);
    case 'lt':
      return typeof actual === 'number' && actual < Number(value);
    case 'lte':
      return typeof actual === 'number' && actual <= Number(value);
    case 'contains':
      return typeof actual === 'string' && actual.toLowerCase().includes(String(value).toLowerCase());
    case 'matches':
      try {
        return typeof actual === 'string' && new RegExp(String(value)).test(actual);
      } catch { return false; }
    default:
      return false;
  }
}

function buildUpdates(action: Action, element: TextElement): Record<string, any> {
  const style = { ...(element.style || {}) };
  switch (action.field) {
    case 'font':
      return { font: String(action.value) };
    case 'fontSize':
      return { fontSize: Number(action.value) };
    case 'color':
      style.color = String(action.value);
      return { style };
    case 'bold':
      style.bold = Boolean(action.value);
      return { style };
    case 'italic':
      style.italic = Boolean(action.value);
      return { style };
    case 'underline':
      style.underline = Boolean(action.value);
      return { style };
    case 'content':
      return { content: String(action.value) };
    default:
      return {};
  }
}

export async function bulkStyle(
  docId: string,
  rules: StyleRule[]
): Promise<{ document: PDFDocument; matched: number; matchedIds: string[] }> {
  const doc = loadDocument(docId);
  if (!doc) throw new Error('Document not found');

  const needsColor = rules.some(r => r.conditions.some(c => c.field === 'color'));
  const originalPath = needsColor ? getOriginalPath(docId) : null;

  const pageColorCache = new Map<number, Map<string, string>>();

  const matchedIds: string[] = [];

  for (let pi = 0; pi < doc.pages.length; pi++) {
    const page = doc.pages[pi];
    if (!page.elements.length) continue;

    if (needsColor && originalPath) {
      try {
        const buf = await renderPage(originalPath, pi + 1, 2);
        const colors = new Map<string, string>();
        for (const el of page.elements) {
          if (el.type === 'text') {
            const fg = await extractElementColor(buf, el.bbox, 2);
            colors.set(el.id, fg);
          }
        }
        pageColorCache.set(pi, colors);
      } catch (e) {
        console.error(`Failed to extract colors for page ${pi + 1}:`, e);
      }
    }

    for (const el of page.elements) {
      if (el.type !== 'text') continue;

      for (const rule of rules) {
        const allMatch = rule.conditions.every(c =>
          evaluateCondition(c, el, pageColorCache.get(pi))
        );

        if (allMatch) {
          let updates: Record<string, any> = {};
          for (const action of rule.actions) {
            Object.assign(updates, buildUpdates(action, el));
          }
          if (Object.keys(updates).length > 0) {
            updateElement(doc, pi, el.id, updates);
            matchedIds.push(el.id);
          }
          break;
        }
      }
    }
  }

  saveDocument(doc);
  return { document: doc, matched: matchedIds.length, matchedIds };
}
