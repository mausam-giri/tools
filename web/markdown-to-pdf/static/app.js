(() => {
  "use strict";

  const STORAGE_KEY = "markforge:v4";

  const defaultMarkdown = `# MarkForge Sample

Welcome to a **fast**, client-side Markdown → PDF workflow.

## Why this setup
- Live HTML preview as you type
- Custom CSS scoped to the document only
- **Page Break View** dynamically calculates exact PDF break points in real time!
- **Mermaid Diagrams** support for flowcharts, sequence diagrams, and mind maps!

### Checklist
- [x] Headings, lists, and tables
- [x] Code fences & Mermaid diagrams
- [x] Real-time page break calculation

## Workflow Architecture

\`\`\`mermaid
graph TD
    A[Markdown Source] -->|marked.js| B[HTML Preview]
    A -->|Mermaid.js| C[Rendered Diagrams]
    B --> D[Page Break Simulation]
    C --> D
    D -->|html2pdf.js| E[Exported PDF Document]
\`\`\`

| Feature | Status |
| --- | --- |
| Preview | Live Normal & Page Break |
| Diagrams | Native Mermaid Support |
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

  const defaultCSS = `/* Styles apply only to the document preview */
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

  const $ = (id) => document.getElementById(id);

  const markdownInput = $("markdown-input");
  const cssInput = $("css-input");
  const cssEditorHost = $("css-editor-host");
  const htmlPreview = $("html-preview");
  const pagebreakPreview = $("pagebreak-preview");
  const userStyles = $("user-styles");
  const previewStats = $("preview-stats");
  const pageSizeSelect = $("page-size");
  const btnExport = $("btn-export");
  const workspace = $("workspace");
  const mdToolbar = $("md-toolbar");
  const documentName = $("document-name")

  const PDF_MARGIN_MM = 10;
  let cssEditor = null;
  let currentPaneMode = "split";
  let currentViewMode = "normal";
  let currentPageSize = "a4";
  documentName.value = `Untitled-1`;

  function escapeHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  marked.setOptions({
    gfm: true,
    breaks: false,
  });

  const renderer = new marked.Renderer();
  const originalCodeRenderer = renderer.code.bind(renderer);
  renderer.code = function ({ text, lang, escaped }) {
    if (lang === "mermaid") {
      const rawText = (text || "").trim();
      return `<div class="mermaid-container"><div class="mermaid" data-diagram="${encodeURIComponent(rawText)}">${escapeHtml(rawText)}</div></div>`;
    }
    return originalCodeRenderer({ text, lang, escaped });
  };
  marked.use({ renderer });

  function getCSS() {
    return cssEditor ? cssEditor.getValue() : cssInput.value;
  }

  function setCSS(value) {
    if (cssEditor) cssEditor.setValue(value);
    else cssInput.value = value;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function mmToPx(mm) {
    return (mm / 25.4) * 96;
  }

  function getPageMetrics(size) {
    const isLetter = size === "letter";
    const pageWidthMm = isLetter ? 215.9 : 210;
    const pageHeightMm = isLetter ? 279.4 : 297;
    const padMm = 14;
    const contentHeightMm = pageHeightMm - PDF_MARGIN_MM * 2;
    const contentHeightPx = mmToPx(contentHeightMm - padMm * 2);

    return {
      pageSize: size,
      pageWidthMm,
      pageHeightMm,
      contentHeightMm,
      contentHeightPx,
      padMm,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  function saveState(partial) {
    try {
      const current = loadState();
      const merged = { ...current, ...partial };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (err) {
      console.error(err);
    }
  }

  /** Scope user custom CSS */
  function scopeCSS(css, scopes) {
    const scopeList = scopes.join(", ");
    let out = "";
    let i = 0;
    let buf = "";
    let depth = 0;
    let inString = null;
    let inComment = false;

    const flushRule = (block) => {
      const brace = block.indexOf("{");
      if (brace === -1) {
        out += block;
        return;
      }
      const selectors = block.slice(0, brace).trim();
      const body = block.slice(brace);
      if (!selectors || selectors.startsWith("@")) {
        if (selectors.startsWith("@media") || selectors.startsWith("@supports")) {
          const innerStart = body.indexOf("{");
          const innerEnd = body.lastIndexOf("}");
          if (innerStart !== -1 && innerEnd > innerStart) {
            const inner = body.slice(innerStart + 1, innerEnd);
            out += `${selectors}{${scopeCSS(inner, scopes)}}`;
            return;
          }
        }
        out += block;
        return;
      }
      const scoped = selectors
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          if (s === "body" || s === "html" || s === ":root") {
            return scopeList;
          }
          if (s === ".markdown-body" || s.startsWith(".markdown-body ")) {
            const rest = s === ".markdown-body" ? "" : s.slice(".markdown-body".length);
            return scopes.map((sc) => `${sc}${rest}`).join(", ");
          }
          return scopes.map((sc) => `${sc} ${s}`).join(", ");
        })
        .join(", ");
      out += `${scoped}${body}`;
    };

    while (i < css.length) {
      const ch = css[i];
      const next = css[i + 1];

      if (inComment) {
        buf += ch;
        if (ch === "*" && next === "/") {
          buf += "/";
          i += 2;
          inComment = false;
          continue;
        }
        i++;
        continue;
      }

      if (inString) {
        buf += ch;
        if (ch === "\\" && next) {
          buf += next;
          i += 2;
          continue;
        }
        if (ch === inString) inString = null;
        i++;
        continue;
      }

      if (ch === "/" && next === "*") {
        buf += "/*";
        i += 2;
        inComment = true;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = ch;
        buf += ch;
        i++;
        continue;
      }

      if (ch === "{") {
        depth++;
        buf += ch;
        i++;
        continue;
      }

      if (ch === "}") {
        depth--;
        buf += ch;
        i++;
        if (depth === 0) {
          flushRule(buf);
          buf = "";
        }
        continue;
      }

      buf += ch;
      i++;
    }

    if (buf.trim()) out += buf;
    return out;
  }

  function renderMarkdown(src) {
    const dirty = marked.parse(src || "");
    return DOMPurify.sanitize(dirty, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["data-pagebreak", "data-break", "data-diagram"],
    });
  }

  function wordCount(text) {
    const words = text.trim().match(/\S+/g);
    return words ? words.length : 0;
  }

  function isPageBreakNode(node) {
    return (
      node.nodeType === 1 &&
      (node.hasAttribute("data-pagebreak") ||
        node.getAttribute("data-break") === "page" ||
        node.classList.contains("page-break"))
    );
  }

  function createPageSheet(pageNo, metrics) {
    const wrap = document.createElement("div");
    wrap.className = "page-sheet-wrap";

    const sheet = document.createElement("article");
    sheet.className = "markdown-body page-sheet-card";
    sheet.dataset.page = String(pageNo);
    sheet.style.width = `min(100%, ${metrics.pageWidthMm}mm)`;
    sheet.style.minHeight = `${metrics.pageHeightMm}mm`;
    sheet.style.maxHeight = `${metrics.pageHeightMm}mm`;

    const header = document.createElement("div");
    header.className = "page-sheet-header";

    const label = document.createElement("span");
    label.className = "page-sheet-label";
    label.textContent = `Page ${pageNo}`;
    header.appendChild(label);

    const dim = document.createElement("span");
    dim.className = "page-sheet-dim";
    dim.textContent = `${metrics.pageSize.toUpperCase()} · ${metrics.pageWidthMm}×${metrics.pageHeightMm}mm`;
    header.appendChild(dim);

    sheet.appendChild(header);

    const body = document.createElement("div");
    body.className = "page-sheet-body";
    sheet.appendChild(body);

    wrap.appendChild(sheet);
    return { wrap, sheet, body, pageNo };
  }

  function createBreakMarker(pageNo, kind) {
    const marker = document.createElement("div");
    marker.className = "page-break-divider";
    marker.dataset.kind = kind;

    const badge = document.createElement("span");
    badge.className = "page-break-badge";
    badge.innerHTML =
      kind === "manual"
        ? `<span class="material-symbols-outlined icon-inline">insert_page_break</span> Manual Break · Starts Page ${pageNo}`
        : `<span class="material-symbols-outlined icon-inline">auto_mode</span> Auto Break · Starts Page ${pageNo}`;

    marker.appendChild(badge);
    return marker;
  }

  if (window.mermaid) {
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "loose",
        fontFamily: "Barlow, sans-serif",
        flowchart: { htmlLabels: true, useMaxWidth: true },
        sequence: { useMaxWidth: true },
        gantt: { useMaxWidth: true },
      });
    } catch (err) {
      console.error("Mermaid initialization failed:", err);
    }
  }

  let mermaidCounter = 0;

  async function renderMermaidDiagrams(container) {
    if (!window.mermaid || !container) return;
    const nodes = container.querySelectorAll(".mermaid");
    if (!nodes.length) return;

    const renderPromises = Array.from(nodes).map(async (node) => {
      const rawDiagram = node.dataset.diagram
        ? decodeURIComponent(node.dataset.diagram)
        : node.textContent.trim();
      if (!rawDiagram) return;

      const id = `mermaid-render-${Date.now()}-${++mermaidCounter}`;
      try {
        const { svg } = await mermaid.render(id, rawDiagram);
        node.innerHTML = svg;
        node.classList.remove("mermaid-error");
      } catch (err) {
        console.warn("Mermaid diagram render error:", err);
        const orphan = document.getElementById(id);
        if (orphan) orphan.remove();

        node.classList.add("mermaid-error");
        node.innerHTML = `<div class="mermaid-error-msg">
          <span class="material-symbols-outlined icon-inline">warning</span>
          Invalid Mermaid syntax
        </div>
        <pre><code>${escapeHtml(rawDiagram)}</code></pre>`;
      }
    });

    await Promise.all(renderPromises);
  }

  let currentPageBreakToken = 0;

  /** Real-time Automated Page Break Simulation */
  async function calculateAndRenderPageBreaks(html, userCss, pageSize, container, token) {
    if (!container) return;
    const metrics = getPageMetrics(pageSize);

    // Measure blocks in probe
    const probe = document.createElement("div");
    probe.className = "markdown-body page-sheet-card";
    probe.id = "pdf-measure-root";
    probe.style.cssText = `
      position: absolute; left: -10000px; top: 0; visibility: hidden;
      width: ${metrics.pageWidthMm}mm; height: auto; max-height: none;
      min-height: 0; overflow: visible; padding: ${metrics.padMm}mm;
    `;

    const probeBody = document.createElement("div");
    probeBody.className = "page-sheet-body";
    probeBody.innerHTML = html;
    probe.appendChild(probeBody);
    document.body.appendChild(probe);

    const measureStyle = document.createElement("style");
    measureStyle.textContent = scopeCSS(userCss, ["#pdf-measure-root"]);
    document.head.appendChild(measureStyle);

    // Render Mermaid diagrams in probe first so measurements reflect exact rendered diagram height!
    await renderMermaidDiagrams(probeBody);

    if (token && token !== currentPageBreakToken) {
      probe.remove();
      measureStyle.remove();
      return;
    }

    const blocks = Array.from(probeBody.children);
    const sheets = [];
    const markers = [];

    let pageNo = 1;
    let currentSheet = createPageSheet(pageNo, metrics);
    sheets.push(currentSheet);

    let usedHeight = 0;
    const maxAvailableHeight = Math.max(120, metrics.contentHeightPx);

    const startNewPage = (kind) => {
      pageNo += 1;
      const marker = createBreakMarker(pageNo, kind);
      markers.push(marker);
      const nextSheet = createPageSheet(pageNo, metrics);
      sheets.push(nextSheet);
      currentSheet = nextSheet;
      usedHeight = 0;
    };

    blocks.forEach((block) => {
      if (isPageBreakNode(block)) {
        if (usedHeight > 0 || sheets.length === 1) {
          startNewPage("manual");
        }
        return;
      }

      const clone = block.cloneNode(true);
      const blockRect = block.getBoundingClientRect();
      const blockHeight = blockRect.height;
      const verticalGap = usedHeight > 0 ? 8 : 0;

      if (usedHeight > 0 && usedHeight + verticalGap + blockHeight > maxAvailableHeight) {
        startNewPage("auto");
      }

      currentSheet.body.appendChild(clone);
      usedHeight += verticalGap + Math.max(blockHeight, 1);
    });

    probe.remove();
    measureStyle.remove();

    container.innerHTML = "";
    const totalPages = sheets.length;

    sheets.forEach((s, index) => {
      if (index > 0 && markers[index - 1]) {
        container.appendChild(markers[index - 1]);
      }
      const label = s.sheet.querySelector(".page-sheet-label");
      if (label) {
        label.textContent = `Page ${index + 1} of ${totalPages}`;
      }
      container.appendChild(s.wrap);
    });
  }

  function applyPageSizeMetrics() {
    currentPageSize = pageSizeSelect.value || "a4";
    const metrics = getPageMetrics(currentPageSize);
    document.documentElement.style.setProperty("--page-width", `${metrics.pageWidthMm}mm`);
    document.documentElement.style.setProperty("--page-height", `${metrics.pageHeightMm}mm`);
    htmlPreview.style.minHeight = `${metrics.pageHeightMm}mm`;

    if (currentViewMode === "pagebreak") {
      refreshPageBreakView();
    }
  }

  let currentPreviewToken = 0;

  async function updateNormalPreview() {
    const token = ++currentPreviewToken;
    const html = renderMarkdown(markdownInput.value);
    htmlPreview.innerHTML = html;
    await renderMermaidDiagrams(htmlPreview);
    if (token !== currentPreviewToken) return;
    previewStats.textContent = `${wordCount(markdownInput.value)} words`;
  }

  async function refreshPageBreakView() {
    const token = ++currentPageBreakToken;
    const html = renderMarkdown(markdownInput.value);
    const css = getCSS();
    await calculateAndRenderPageBreaks(html, css, currentPageSize, pagebreakPreview, token);
  }

  function updateStyles() {
    const css = getCSS();
    userStyles.textContent = scopeCSS(css, [
      "#html-preview",
      ".page-sheet-card",
      "#pdf-export-root",
      "#pdf-measure-root",
    ]);

    if (currentViewMode === "pagebreak") {
      refreshPageBreakView();
    }
  }

  function setPaneMode(mode) {
    currentPaneMode = mode;
    workspace.classList.toggle("editor-hidden", mode === "preview");
    workspace.classList.toggle("preview-hidden", mode === "editor");

    document.querySelectorAll(".panel-toggle-btn").forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-checked", String(active));
    });

    if (mode !== "preview" && cssEditorHost.classList.contains("active") && cssEditor) {
      requestAnimationFrame(() => cssEditor.refresh());
    }

    saveState({ paneMode: mode });
  }

  function setViewMode(mode) {
    currentViewMode = mode;

    document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
      const active = btn.dataset.view === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-checked", String(active));
    });

    if (mode === "normal") {
      htmlPreview.style.display = "block";
      pagebreakPreview.style.display = "none";
      updateNormalPreview();
    } else {
      htmlPreview.style.display = "none";
      pagebreakPreview.style.display = "flex";
      pagebreakPreview.style.flexDirection = "column";
      refreshPageBreakView();
    }

    saveState({ viewMode: mode });
  }

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    markdownInput.classList.toggle("active", name === "markdown");
    cssEditorHost.classList.toggle("active", name === "css");
    if (mdToolbar) mdToolbar.hidden = name !== "markdown";

    if (name === "css" && cssEditor) {
      requestAnimationFrame(() => {
        cssEditor.refresh();
        cssEditor.focus();
      });
    } else if (name === "markdown") {
      markdownInput.focus();
    }
  }

  function initCssEditor(initialCss) {
    cssInput.value = initialCss;
    cssEditor = CodeMirror.fromTextArea(cssInput, {
      mode: "css",
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
      indentWithTabs: false,
      autofocus: false,
      autoCloseBrackets: true,
      extraKeys: {
        "Ctrl-Space": "autocomplete",
        "Cmd-Space": "autocomplete",
      },
      hintOptions: {
        completeSingle: false,
      },
    });

    cssEditor.on("change", () => {
      debouncedStyles();
      debouncedPersist();
    });
  }

  function validateDocumentName() {
    if (documentName.value.trim() === "") {
      documentName.focus();
      documentName.classList.add("invalid-name");
      return false;
    }

    documentName.classList.remove("invalid-name");
    return true;
  }

  documentName.addEventListener("input", () => {
    if (documentName.value.trim() === "") {
      documentName.classList.add("invalid-name");
    } else {
      documentName.classList.remove("invalid-name");
    }
  });

  // documentName.addEventListener("blur", validateDocumentName);

  async function exportPDF() {
    if (!validateDocumentName()) return;
    if (!btnExport) return;

    btnExport.disabled = true;

    const format = currentPageSize === "letter" ? "letter" : "a4";
    const metrics = getPageMetrics(currentPageSize);
    const pageWidth = `${metrics.pageWidthMm}mm`;

    const clone = document.createElement("article");
    clone.id = "pdf-export-root";
    clone.className = "markdown-body page-sheet";
    clone.style.width = pageWidth;
    clone.style.minHeight = "auto";
    clone.style.boxShadow = "none";
    clone.style.borderRadius = "0";
    clone.style.margin = "0";
    clone.style.padding = "0";
    clone.innerHTML = renderMarkdown(markdownInput.value);

    const mount = document.createElement("div");
    mount.style.position = "fixed";
    mount.style.left = "-10000px";
    mount.style.top = "0";
    mount.style.width = pageWidth;
    mount.appendChild(clone);

    const style = document.createElement("style");
    style.textContent = scopeCSS(getCSS(), ["#pdf-export-root"]);
    mount.appendChild(style);
    document.body.appendChild(mount);

    await renderMermaidDiagrams(clone);

    const opt = {
      margin: [PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_MARGIN_MM],
      filename: documentName.value.trim(),
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      },
      jsPDF: { unit: "mm", format, orientation: "portrait" },
      pagebreak: {
        mode: ["css", "legacy"],
        after: '[data-pagebreak], [data-break="page"], .page-break',
        avoid: ["img", "pre", "table", "blockquote", ".mermaid-container", ".mermaid", "svg"],
      },
    };

    try {
      await html2pdf().set(opt).from(clone).save();
    } catch (err) {
      console.error("Export failed:", err);
      alert("PDF export failed. Please check document content or try again.");
    } finally {
      mount.remove();
      btnExport.disabled = false;
    }
  }

  function initSplitter() {
    const splitter = $("splitter");
    const editor = document.querySelector(".editor-pane");
    if (!splitter || !editor || !workspace) return;
    let dragging = false;

    const onMove = (clientX, clientY) => {
      if (!dragging) return;
      const rect = workspace.getBoundingClientRect();
      const isVertical = window.matchMedia("(max-width: 860px)").matches;
      if (isVertical) {
        const y = clientY - rect.top;
        const pct = Math.min(75, Math.max(25, (y / rect.height) * 100));
        editor.style.flex = `0 0 ${pct}%`;
      } else {
        const x = clientX - rect.left;
        const pct = Math.min(75, Math.max(25, (x / rect.width) * 100));
        editor.style.flex = `0 0 ${pct}%`;
      }
    };

    splitter.addEventListener("pointerdown", (e) => {
      dragging = true;
      splitter.classList.add("active");
      splitter.setPointerCapture(e.pointerId);
    });

    splitter.addEventListener("pointermove", (e) => onMove(e.clientX, e.clientY));

    splitter.addEventListener("pointerup", () => {
      dragging = false;
      splitter.classList.remove("active");
    });
  }

  function getMdSelection() {
    const start = markdownInput.selectionStart;
    const end = markdownInput.selectionEnd;
    return {
      start,
      end,
      value: markdownInput.value,
      selected: markdownInput.value.slice(start, end),
    };
  }

  function setMdSelection(next, cursorStart, cursorEnd) {
    markdownInput.value = next;
    markdownInput.focus();
    markdownInput.setSelectionRange(cursorStart, cursorEnd);
    markdownInput.dispatchEvent(new Event("input"));
  }

  function wrapSelection(before, after = before, placeholder = "text") {
    const { start, end, value, selected } = getMdSelection();
    const inner = selected || placeholder;
    const next = value.slice(0, start) + before + inner + after + value.slice(end);
    const selStart = start + before.length;
    setMdSelection(next, selStart, selStart + inner.length);
  }

  function prefixLines(prefix, placeholder = "item") {
    const { start, end, value, selected } = getMdSelection();
    const block = selected || placeholder;
    const lined = block
      .split("\n")
      .map((line, i) => {
        const p = typeof prefix === "function" ? prefix(i) : prefix;
        return line.match(/^\s*$/) ? line : `${p}${line}`;
      })
      .join("\n");
    const next = value.slice(0, start) + lined + value.slice(end);
    setMdSelection(next, start, start + lined.length);
  }

  function insertBlock(block, selectOffset = 0, selectLen = 0) {
    const { start, end, value } = getMdSelection();
    const needsLead = start > 0 && value[start - 1] !== "\n" ? "\n\n" : start > 0 ? "\n" : "";
    const needsTrail = end < value.length && value[end] !== "\n" ? "\n\n" : "\n";
    const chunk = needsLead + block + needsTrail;
    const next = value.slice(0, start) + chunk + value.slice(end);
    const selStart = start + needsLead.length + selectOffset;
    setMdSelection(next, selStart, selStart + selectLen);
  }

  function applyMarkdownAction(action) {
    switch (action) {
      case "bold":
        wrapSelection("**", "**", "bold text");
        break;
      case "italic":
        wrapSelection("*", "*", "italic text");
        break;
      case "strike":
        wrapSelection("~~", "~~", "strikethrough");
        break;
      case "highlight":
        wrapSelection("<mark>", "</mark>", "highlighted");
        break;
      case "h1":
        prefixLines("# ", "Heading 1");
        break;
      case "h2":
        prefixLines("## ", "Heading 2");
        break;
      case "h3":
        prefixLines("### ", "Heading 3");
        break;
      case "h4":
        prefixLines("#### ", "Heading 4");
        break;
      case "link": {
        const { selected } = getMdSelection();
        const label = selected || "link text";
        wrapSelection("[", "](https://)", label);
        break;
      }
      case "image":
        insertBlock("![alt text](https://)", 2, 8);
        break;
      case "code":
        wrapSelection("`", "`", "code");
        break;
      case "codeblock":
        insertBlock("```js\ncode\n```", 6, 4);
        break;
      case "quote":
        prefixLines("> ", "quote");
        break;
      case "ul":
        prefixLines("- ", "item");
        break;
      case "ol":
        prefixLines((i) => `${i + 1}. `, "item");
        break;
      case "task":
        prefixLines("- [ ] ", "task");
        break;
      case "table":
        insertBlock(
          "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| A | B | C |\n| D | E | F |",
          2,
          8
        );
        break;
      case "hr":
        insertBlock("---");
        break;
      case "mermaid":
        insertBlock(
          "```mermaid\ngraph TD\n    A[Start] --> B{Is it working?}\n    B -- Yes --> C[Great!]\n    B -- No --> D[Debug]\n```",
          11,
          58
        );
        break;
      case "pagebreak":
        insertBlock('<div data-pagebreak></div>');
        break;
      case "footnote":
        insertBlock("Here is a footnote reference[^1].\n\n[^1]: Footnote definition.", 28, 2);
        break;
      case "toc":
        insertBlock(
          "## Table of Contents\n\n- [Section](#section)\n- [Another](#another)",
          5,
          16
        );
        break;
      default:
        break;
    }
  }

  function resetDefaults() {
    markdownInput.value = defaultMarkdown;
    setCSS(defaultCSS);
    pageSizeSelect.value = "a4";

    applyPageSizeMetrics();
    updateNormalPreview();
    updateStyles();
    saveState({
      markdown: defaultMarkdown,
      css: defaultCSS,
      pageSize: "a4",
      paneMode: "split",
      viewMode: "normal",
    });
  }

  const debouncedPersist = debounce(() => {
    saveState({
      markdown: markdownInput.value,
      css: getCSS(),
      pageSize: pageSizeSelect.value,
    });
  }, 400);

  const debouncedPreview = debounce(() => {
    updateNormalPreview();
    if (currentViewMode === "pagebreak") {
      refreshPageBreakView();
    }
  }, 100);

  const debouncedStyles = debounce(() => {
    updateStyles();
  }, 100);

  // Wire Events
  document.querySelectorAll(".panel-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      setPaneMode(e.currentTarget.dataset.mode);
    });
  });

  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      setViewMode(e.currentTarget.dataset.view);
    });
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      switchTab(e.currentTarget.dataset.tab || "markdown");
    });
  });

  if (mdToolbar) {
    mdToolbar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-md]");
      if (!btn) return;
      applyMarkdownAction(btn.dataset.md);
    });
  }

  markdownInput.addEventListener("input", () => {
    debouncedPreview();
    debouncedPersist();
  });

  pageSizeSelect.addEventListener("change", () => {
    applyPageSizeMetrics();
    debouncedPersist();
  });

  btnExport.addEventListener("click", exportPDF);

  const resetBtn = $("btn-reset");
  if (resetBtn) resetBtn.addEventListener("click", resetDefaults);

  markdownInput.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        applyMarkdownAction("bold");
      } else if (k === "i") {
        e.preventDefault();
        applyMarkdownAction("italic");
      } else if (k === "k") {
        e.preventDefault();
        applyMarkdownAction("link");
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const start = markdownInput.selectionStart;
      const end = markdownInput.selectionEnd;
      markdownInput.value = `${markdownInput.value.slice(0, start)}  ${markdownInput.value.slice(end)}`;
      markdownInput.selectionStart = markdownInput.selectionEnd = start + 2;
      markdownInput.dispatchEvent(new Event("input"));
    }
  });

  // Boot
  const saved = loadState();
  markdownInput.value = saved.markdown ?? defaultMarkdown;
  pageSizeSelect.value = saved.pageSize ?? "a4";
  initCssEditor(saved.css ?? defaultCSS);

  applyPageSizeMetrics();
  updateNormalPreview();
  updateStyles();
  initSplitter();

  setPaneMode(saved.paneMode ?? "split");
  setViewMode(saved.viewMode ?? "normal");
})();
