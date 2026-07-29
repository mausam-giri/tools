import type { AppState, PageSize, PaneMode, ViewMode } from './types';

export const STORAGE_KEY = 'markforge:v4';

export const defaultMarkdown = `# MarkForge Sample

Welcome to a **fast**, client-side Markdown → PDF workflow.

## Why this setup
- Live HTML preview as you type
- Custom CSS scoped to the document only
- **Page Break View** dynamically calculates exact PDF break points in real time!

### Checklist
- [x] Headings, lists, and tables
- [x] Code fences
- [x] Real-time page break calculation

| Feature | Status |
| --- | --- |
| Preview | Live Normal & Page Break |
| CSS | Editable & Scoped |
| PDF | Pixel-Perfect Export |

\`\`\`js
function exportReady(doc) {
  return Boolean(doc?.title);
}
\`\`\`

> Tip: use the **Page ↵** toolbar button, or insert \`<div data-pagebreak></div>\`.

<div data-pagebreak></div>

## After the break

This section starts on a **new PDF page**. Toggle to **Page Break View** in the preview header to see real-time break markers.
`;

export const defaultCSS = `/* Styles apply only to the document preview */
body {
  font-family: "Barlow", sans-serif;
  color: #1a2330;
  line-height: 1.65;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em 0;
  border-radius: 6px;
}

h1 {
  font-family: "Barlow", sans-serif;
  font-weight: 700;
  color: #0b3d38;
  border-bottom: 2px solid #d5e2df;
  padding-bottom: 0.35em;
  margin-top: 0;
}

h2 {
  font-family: "Barlow", sans-serif;
  font-weight: 600;
  color: #134e48;
  margin-top: 1.4em;
}

h3 {
  font-family: "Barlow", sans-serif;
  font-weight: 600;
  color: #1a5c54;
  margin-top: 1.2em;
}

code {
  font-family: "Fira Code", monospace;
  font-size: 0.9em;
  background: #eef3f7;
  padding: 0.15em 0.4em;
  border-radius: 4px;
}

pre {
  font-family: "Fira Code", monospace;
  background: #0f1c2e !important;
  border-radius: 8px;
  padding: 1em;
  overflow: auto;
}

pre code {
  font-family: "Fira Code", monospace;
  background: transparent;
  color: #e8eef4;
  padding: 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.2em 0;
  font-family: "Barlow", sans-serif;
}

thead {
  background: #e8f4f2;
}

th,
td {
  border: 1px solid #d5e2df;
  padding: 0.55em 0.75em;
  text-align: left;
}

th {
  font-weight: 600;
  color: #0b3d38;
}

tbody tr:nth-child(even) {
  background: #f7fafc;
}

blockquote {
  border-left: 4px solid #0d7a6f;
  color: #4a5a6a;
  background: #f3faf8;
  padding: 0.6em 1em;
  margin: 1em 0;
  font-style: italic;
}
`;

export function loadState(): Partial<AppState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveState(state: Partial<AppState>): void {
  try {
    const current = loadState();
    const merged = { ...current, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}
