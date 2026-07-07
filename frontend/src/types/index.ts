export interface TextElement {
  id: string;
  type: 'text';
  content: string;
  bbox: [number, number, number, number];
  font?: string;
  fontError?: number;
  fontSize?: number;
  confidence?: number;
  editable: boolean;
  page: number;
  alignment?: 'left' | 'center' | 'right';
  groupIndex?: number;
  coverBbox?: [number, number, number, number];
  style?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
  };
}

export interface ImageElement {
  id: string;
  type: 'image';
  src: string;
  bbox: [number, number, number, number];
  page: number;
}

export type PageElement = TextElement | ImageElement;

export interface PDFPage {
  elements: PageElement[];
  width: number;
  height: number;
}

export interface PDFDocument {
  id: string;
  name: string;
  pages: PDFPage[];
  metadata?: {
    author?: string;
    title?: string;
    pageCount: number;
  };
  overlays: ImageOverlay[];
}

export interface ImageOverlay {
  id: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  pageRange: { from: number; to: number };
}

export interface EntityDetection {
  entity: string;
  type: 'product_code' | 'number' | 'identifier' | 'text';
  confidence: number;
  startIndex: number;
  endIndex: number;
  suggestedTransformation?: string;
}

export interface TransformationResult {
  original: string;
  transformed: string;
  entities: EntityDetection[];
  appliedRules: string[];
  approved?: boolean;
}

export interface SkillRule {
  id: string;
  name: string;
  description: string;
  pattern: string;
  replacement: string;
  digitShift?: number;
  preserveSegments?: number[];
  shiftGroups?: number[];
  exceptions?: string[];
  priority: number;
}

export interface SkillFile {
  id: string;
  name: string;
  version: string;
  description: string;
  rules: SkillRule[];
  metadata?: Record<string, unknown>;
}

export interface Annotation {
  id: string;
  type: 'highlight' | 'underline' | 'strike' | 'comment';
  elementId: string;
  page: number;
  content?: string;
  color?: string;
  bbox?: [number, number, number, number];
}

export interface EditorState {
  document: PDFDocument | null;
  pdfUrl: string | null;
  currentPage: number;
  zoom: number;
  selectedElementId: string | null;
  selectedText: string | null;
  annotations: Annotation[];
  editHistory: HistoryEntry[];
  historyIndex: number;
  mode: 'select' | 'text' | 'highlight' | 'annotation' | 'image';
  aiResult: TransformationResult | null;
  showAIPanel: boolean;
  showSkillPanel: boolean;
  showStylePanel: boolean;
  editedIds: string[];
}

export interface HistoryEntry {
  document: PDFDocument;
  editedIds: string[];
  timestamp: number;
  description: string;
}

export interface Condition {
  field: string;
  op: string;
  value: any;
}

export interface Action {
  field: string;
  value: any;
}

export interface StyleRule {
  name?: string;
  conditions: Condition[];
  actions: Action[];
}
