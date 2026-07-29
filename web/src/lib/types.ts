export type PaneMode = 'split' | 'editor' | 'preview';
export type ViewMode = 'normal' | 'pagebreak';
export type PageSize = 'a4' | 'letter';
export type PageBreakKind = 'manual' | 'auto';

export interface PageMetrics {
  pageSize: PageSize;
  pageWidthMm: number;
  pageHeightMm: number;
  contentHeightMm: number;
  contentHeightPx: number;
  padMm: number;
}

export interface AppState {
  markdown: string;
  css: string;
  pageSize: PageSize;
  paneMode: PaneMode;
  viewMode: ViewMode;
}

export interface MarkdownAction {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
}
