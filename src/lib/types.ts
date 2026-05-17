export type RenderState = "loading" | "readable" | "enhanced" | "error";

export interface DocumentPayload {
  path: string;
  content: string;
  size: number;
  mtime: number;
  encoding: string;
}

export type ImageStatus = "pending" | "loaded" | "missing" | "remote";

export interface ImageIndexItem {
  id: string;
  src: string;
  alt: string;
  title: string | null;
  line: number;
  column: number;
  absolutePath: string;
  status: ImageStatus;
  error?: string;
}

export interface FlowchartIndexItem {
  id: string;
  language: "mermaid" | "flowchart";
  code: string;
  line: number;
  column: number;
  previewSrc: string | null;
}

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

export interface SaveResult {
  path: string;
  size: number;
  savedAt: number;
}

export interface AssetResult {
  original: string;
  resolved: string;
  isRemote: boolean;
}
