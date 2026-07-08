export interface TextElement {
  id: string;
  type: 'text';
  content: string;
  bbox: [number, number, number, number];
  font?: string;
  fontError?: number;
  fontSize?: number;
  editable: boolean;
  page?: number;
  alignment?: 'left' | 'center' | 'right';
  groupIndex?: number;
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
  originalData?: Buffer;
}

export type PageElement = TextElement | ImageElement;

export interface PDFPage {
  elements: PageElement[];
  width: number;
  height: number;
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

export interface DetectedQRCode {
  id: string;
  page: number;
  content: string;
  bbox: [number, number, number, number];
  corners?: [number, number][];
}

export interface QRCodeCoverAction {
  id: string;
  coverQR: boolean;
  coverDesc: boolean;
  color: string;
  pageRange: { from: number; to: number };
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
  detectedQRCodes?: DetectedQRCode[];
  qrCodeCoverActions?: QRCodeCoverAction[];
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

export interface AIRequest {
  text: string;
  context?: {
  page?: number;
    bbox: [number, number, number, number];
    nearbyElements?: string[];
  };
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

export interface VersionEntry {
  id: string;
  timestamp: number;
  documentId: string;
  changes: {
    elementId: string;
    previous: string;
    current: string;
  }[];
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

export interface ColumnBoundary {
  left: number;
  right: number;
}
