import { create } from 'zustand';
import {
  EditorState,
  PDFDocument,
  PageElement,
  Annotation,
  TransformationResult,
  HistoryEntry,
  ImageOverlay,
  DetectedQRCode,
  QRCodeCoverAction,
} from '../types';

interface EditorActions {
  setDocument: (doc: PDFDocument, pdfUrl?: string) => void;
  setCurrentPage: (page: number) => void;
  setPageElements: (page: number, elements: PageElement[]) => void;
  setZoom: (zoom: number) => void;
  selectElement: (id: string | null) => void;
  setSelectedText: (text: string | null) => void;
  updateElement: (page: number, elementId: string, updates: Partial<PageElement>) => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (id: string) => void;
  setMode: (mode: EditorState['mode']) => void;
  setAIResult: (result: TransformationResult | null) => void;
  toggleAIPanel: () => void;
  toggleSkillPanel: () => void;
  toggleStylePanel: () => void;
  pushHistory: (description: string) => void;
  undo: () => void;
  redo: () => void;
  resetToOriginal: () => void;
  applyTransformation: (transformed: string) => void;
  addElement: (page: number, element: PageElement) => void;
  markElementEdited: (id: string) => void;
  unmarkElementEdited: (id: string) => void;
  clearEditedIds: () => void;
  updateOverlays: (overlays: ImageOverlay[]) => void;
  updateOverlay: (id: string, patch: Partial<ImageOverlay>) => void;
  removeOverlay: (id: string) => void;
  setDetectedQRCodes: (qrCodes: DetectedQRCode[]) => void;
  setQRCodeCoverActions: (actions: QRCodeCoverAction[]) => void;
}

type EditorStore = EditorState & EditorActions;

const initialState: EditorState = {
  document: null,
  pdfUrl: null,
  currentPage: 0,
  zoom: 1,
  selectedElementId: null,
  selectedText: null,
  annotations: [],
  editHistory: [],
  historyIndex: -1,
  mode: 'select',
  aiResult: null,
  showAIPanel: false,
  showSkillPanel: false,
  showStylePanel: false,
  editedIds: [],
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...initialState,

  setDocument: (doc, pdfUrl) =>
    set({
      document: doc,
      pdfUrl: pdfUrl || null,
      currentPage: 0,
      zoom: 1,
      selectedElementId: null,
      annotations: [],
      editHistory: [{ document: JSON.parse(JSON.stringify(doc)), editedIds: [], timestamp: Date.now(), description: 'Document loaded' }],
      historyIndex: 0,
      editedIds: [],
    }),

  setCurrentPage: (page) => set({ currentPage: page }),

  setPageElements: (page, elements) => {
    const state = get();
    if (!state.document) return;
    const doc = JSON.parse(JSON.stringify(state.document)) as PDFDocument;
    if (doc.pages[page]) {
      doc.pages[page].elements = elements;
      set({ document: doc });
    }
  },
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(5, zoom)) }),

  selectElement: (id) => set({ selectedElementId: id }),

  setSelectedText: (text) => set({ selectedText: text }),

  markElementEdited: (id: string) => {
    set((state) => {
      if (state.editedIds.includes(id)) return state;
      if (!state.document) return { editedIds: [...state.editedIds, id] };
      const doc = JSON.parse(JSON.stringify(state.document)) as PDFDocument;
      const el = doc.pages[state.currentPage]?.elements?.find(e => e.id === id);
      if (el && el.type === 'text' && !el.coverBbox) {
        el.coverBbox = [...el.bbox];
      }
      return { document: doc, editedIds: [...state.editedIds, id] };
    });
  },

  clearEditedIds: () => set({ editedIds: [] }),

  updateOverlays: (overlays: ImageOverlay[]) => {
    const state = get();
    if (!state.document) return;
    const doc = JSON.parse(JSON.stringify(state.document)) as PDFDocument;
    doc.overlays = overlays;
    set({ document: doc });
  },

  updateOverlay: (id, patch) => {
    const state = get();
    if (!state.document) return;
    const doc = JSON.parse(JSON.stringify(state.document)) as PDFDocument;
    const idx = doc.overlays?.findIndex(o => o.id === id);
    if (idx !== undefined && idx >= 0) {
      doc.overlays[idx] = { ...doc.overlays[idx], ...patch };
      set({ document: doc });
    }
  },

  removeOverlay: (id) => {
    const state = get();
    if (!state.document) return;
    const doc = JSON.parse(JSON.stringify(state.document)) as PDFDocument;
    doc.overlays = (doc.overlays || []).filter(o => o.id !== id);
    set({ document: doc });
  },

  addElement: (page, element) => {
    const state = get();
    if (!state.document) return;
    const doc = JSON.parse(JSON.stringify(state.document)) as PDFDocument;
    if (doc.pages[page]) {
      doc.pages[page].elements.push(element);
      set({ document: doc });
    }
  },

  unmarkElementEdited: (id: string) => {
    set((state) => ({
      editedIds: state.editedIds.filter(eid => eid !== id),
    }));
  },

  updateElement: (page, elementId, updates) => {
    const state = get();
    if (!state.document) return;

    const doc = JSON.parse(JSON.stringify(state.document)) as PDFDocument;
    const el = doc.pages[page]?.elements?.find((e) => e.id === elementId);
    if (el) {
      Object.assign(el, updates);
      set({ document: doc });
    }
  },

  addAnnotation: (annotation) =>
    set((state) => ({ annotations: [...state.annotations, annotation] })),

  removeAnnotation: (id) =>
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== id),
    })),

  setMode: (mode) => set({ mode }),

  setAIResult: (result) => set({ aiResult: result }),

  toggleAIPanel: () =>
    set((state) => ({
      showAIPanel: !state.showAIPanel,
      showSkillPanel: false,
      showStylePanel: false,
    })),

  toggleSkillPanel: () =>
    set((state) => ({
      showSkillPanel: !state.showSkillPanel,
      showAIPanel: false,
      showStylePanel: false,
    })),
  toggleStylePanel: () =>
    set((state) => ({
      showStylePanel: !state.showStylePanel,
      showAIPanel: false,
      showSkillPanel: false,
    })),

  pushHistory: (description) => {
    const state = get();
    if (!state.document) return;

    const entry: HistoryEntry = {
      document: JSON.parse(JSON.stringify(state.document)),
      editedIds: [...state.editedIds],
      timestamp: Date.now(),
      description,
    };

    const newHistory = state.editHistory.slice(0, state.historyIndex + 1);
    newHistory.push(entry);

    set({
      editHistory: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return;

    const newIndex = state.historyIndex - 1;
    const entry = state.editHistory[newIndex];

    set({
      document: JSON.parse(JSON.stringify(entry.document)),
      editedIds: [...entry.editedIds],
      historyIndex: newIndex,
      selectedElementId: null,
    });
  },

  resetToOriginal: () => {
    const state = get();
    if (state.editHistory.length === 0) return;
    const entry = state.editHistory[0];
    set({
      document: JSON.parse(JSON.stringify(entry.document)),
      editedIds: [],
      historyIndex: 0,
      selectedElementId: null,
    });
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.editHistory.length - 1) return;

    const newIndex = state.historyIndex + 1;
    const entry = state.editHistory[newIndex];

    set({
      document: JSON.parse(JSON.stringify(entry.document)),
      editedIds: [...entry.editedIds],
      historyIndex: newIndex,
      selectedElementId: null,
    });
  },

  setDetectedQRCodes: (qrCodes) => {
    const state = get();
    if (!state.document) return;
    const doc = JSON.parse(JSON.stringify(state.document)) as PDFDocument;
    doc.detectedQRCodes = qrCodes;
    set({ document: doc });
  },

  setQRCodeCoverActions: (actions) => {
    const state = get();
    if (!state.document) return;
    const doc = JSON.parse(JSON.stringify(state.document)) as PDFDocument;
    doc.qrCodeCoverActions = actions;
    set({ document: doc });
  },

  applyTransformation: (transformed) => {
    const state = get();
    if (!state.document || !state.selectedElementId) return;

    state.pushHistory('AI transformation applied');

    const id = state.selectedElementId;
    const doc = JSON.parse(JSON.stringify(state.document)) as PDFDocument;
    const el = doc.pages[state.currentPage]?.elements?.find(
      (e) => e.id === id
    );
    if (el && el.type === 'text') {
      el.content = transformed;
    }

    set({
      document: doc,
      aiResult: null,
      showAIPanel: false,
      editedIds: state.editedIds.includes(id)
        ? state.editedIds
        : [...state.editedIds, id],
    });
  },
}));
