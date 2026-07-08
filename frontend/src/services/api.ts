import { PDFDocument, PageElement, TransformationResult, SkillFile, EntityDetection, StyleRule, ImageOverlay, DetectedQRCode, QRCodeCoverAction } from '../types';
import { API_BASE } from '../config';

const BASE = API_BASE;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  async uploadPDF(file: File): Promise<{ success: boolean; document: PDFDocument; pdfUrl: string; usage?: { prompt: number; cached: number; output: number; total: number } }> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/pdf/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('Upload failed');

    const reader = res.body?.getReader();
    if (!reader) return res.json();

    const decoder = new TextDecoder();
    let buf = '';
    const pending: Array<{ type: string; message?: string; data?: any }> = [];

    const flushPending = () => {
      for (const evt of pending) {
        if (evt.type === 'error') throw new Error(evt.message || 'Upload failed');
        if (evt.type === 'done') return evt.data;
      }
      return null;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (['ai', 'page', 'group', 'raw_response'].includes(evt.type)) {
            console.log(evt.message || evt.type);
          }
          if (evt.type === 'error') throw new Error(evt.message || 'Upload failed');
          if (evt.type === 'done') return evt.data;
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
    throw new Error('Upload stream ended without completion');
  },

  async getDocument(id: string): Promise<{ document: PDFDocument }> {
    return request(`/pdf/${id}`);
  },

  async saveDocument(document: PDFDocument): Promise<{ success: boolean }> {
    return request(`/pdf/${document.id}/save`, {
      method: 'POST',
      body: JSON.stringify({ document }),
    });
  },

  async updateElement(
    docId: string,
    pageIndex: number,
    elementId: string,
    updates: Record<string, unknown>
  ): Promise<{ success: boolean; document: PDFDocument }> {
    return request(`/pdf/${docId}/pages/${pageIndex}/elements/${elementId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async processPage(docId: string, pageNum: number): Promise<{ success: boolean; elements: PageElement[]; page: number; usage?: { prompt: number; cached: number; output: number; total: number } }> {
    return request(`/pdf/${docId}/page/${pageNum}/process`, { method: 'POST' });
  },

  async listDocuments(): Promise<{ documents: Array<{ id: string; name: string; pageCount: number }> }> {
    return request('/pdf');
  },

  async detectEntities(text: string): Promise<{ entities: EntityDetection[] }> {
    return request('/ai/detect', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  async transformText(
    text: string,
    skillId?: string,
    instruction?: string
  ): Promise<TransformationResult> {
    return request('/ai/transform', {
      method: 'POST',
      body: JSON.stringify({ text, skillId, instruction }),
    });
  },

  async analyzeText(text: string): Promise<{ entities: EntityDetection[]; summary: string }> {
    return request('/ai/analyze', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  async listSkills(): Promise<{ skills: SkillFile[] }> {
    return request('/skill');
  },

  async loadSkill(content: string): Promise<{ success: boolean; skill: SkillFile }> {
    return request('/skill/load', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  async applySkillTransform(
    text: string,
    skillId?: string
  ): Promise<TransformationResult> {
    return request('/skill/transform', {
      method: 'POST',
      body: JSON.stringify({ text, skillId }),
    });
  },

  async saveSkill(content: string, filename?: string): Promise<{ success: boolean; skill: SkillFile }> {
    return request('/skill/save', {
      method: 'POST',
      body: JSON.stringify({ content, filename }),
    });
  },

  async bulkStyle(docId: string, rules: StyleRule[]): Promise<{ success: boolean; document: PDFDocument; matched: number; matchedIds: string[] }> {
    return request(`/pdf/${docId}/bulk-style`, {
      method: 'POST',
      body: JSON.stringify({ rules }),
    });
  },

  async bulkFindReplace(docId: string, find: string, replace: string): Promise<{ success: boolean; document: PDFDocument; matched: number; matchedIds: string[] }> {
    return request(`/pdf/${docId}/bulk-find-replace`, {
      method: 'POST',
      body: JSON.stringify({ find, replace }),
    });
  },

  async uploadImage(file: File): Promise<{ success: boolean; id: string; url: string }> {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${BASE}/pdf/uploads/image`, { method: 'POST', body: form });
    if (!res.ok) throw new Error('Image upload failed');
    return res.json();
  },

  async detectQRCodes(docId: string, pages?: number[]): Promise<{ qr: DetectedQRCode[] }> {
    return request(`/pdf/${docId}/detect-qr`, {
      method: 'POST',
      body: JSON.stringify({ pages }),
    });
  },

  async applyQRCodeCovers(docId: string, actions: QRCodeCoverAction[]): Promise<{ success: boolean; document: PDFDocument }> {
    return request(`/pdf/${docId}/apply-qr-covers`, {
      method: 'POST',
      body: JSON.stringify({ actions }),
    });
  },

  async applyOverlays(docId: string, overlays: ImageOverlay[]): Promise<{ success: boolean; document: PDFDocument }> {
    return request(`/pdf/${docId}/apply-overlays`, {
      method: 'POST',
      body: JSON.stringify({ overlays }),
    });
  },

  async exportPDF(docId: string, editedIds: string[]): Promise<Blob> {
    const res = await fetch(`${BASE}/pdf/${docId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editedIds }),
    });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  },
};
