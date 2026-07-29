import type { PageMetrics, PageSize, PageBreakKind } from './types';
import { scopeCSS } from './css-scoper';

export const PDF_MARGIN_MM = 10;

export function mmToPx(mm: number): number {
  return (mm / 25.4) * 96;
}

export function getPageMetrics(pageSize: PageSize): PageMetrics {
  const isLetter = pageSize === 'letter';
  const pageWidthMm = isLetter ? 215.9 : 210;
  const pageHeightMm = isLetter ? 279.4 : 297;
  const padMm = 14;
  const contentHeightMm = pageHeightMm - PDF_MARGIN_MM * 2;
  const contentHeightPx = mmToPx(contentHeightMm - padMm * 2);

  return {
    pageSize,
    pageWidthMm,
    pageHeightMm,
    contentHeightMm,
    contentHeightPx,
    padMm,
  };
}

export function isPageBreakNode(node: Element): boolean {
  return (
    node.hasAttribute('data-pagebreak') ||
    node.getAttribute('data-break') === 'page' ||
    node.classList.contains('page-break')
  );
}

export function createBreakMarker(pageNo: number, kind: PageBreakKind): HTMLElement {
  const marker = document.createElement('div');
  marker.className = 'page-break-divider';
  marker.dataset.kind = kind;

  const badge = document.createElement('span');
  badge.className = 'page-break-badge';
  badge.innerHTML =
    kind === 'manual'
      ? `<span class="material-symbols-outlined icon-inline">insert_page_break</span> Manual Break · Starts Page ${pageNo}`
      : `<span class="material-symbols-outlined icon-inline">auto_mode</span> Auto Break · Starts Page ${pageNo}`;

  marker.appendChild(badge);
  return marker;
}

export interface RenderedSheet {
  wrap: HTMLElement;
  sheet: HTMLElement;
  body: HTMLElement;
  pageNo: number;
}

export function createPageSheet(pageNo: number, metrics: PageMetrics): RenderedSheet {
  const wrap = document.createElement('div');
  wrap.className = 'page-sheet-wrap';

  const sheet = document.createElement('article');
  sheet.className = 'markdown-body page-sheet-card';
  sheet.dataset.page = String(pageNo);
  sheet.style.width = `min(100%, ${metrics.pageWidthMm}mm)`;
  sheet.style.minHeight = `${metrics.pageHeightMm}mm`;
  sheet.style.maxHeight = `${metrics.pageHeightMm}mm`;

  const header = document.createElement('div');
  header.className = 'page-sheet-header';

  const label = document.createElement('span');
  label.className = 'page-sheet-label';
  label.textContent = `Page ${pageNo}`;
  header.appendChild(label);

  const dim = document.createElement('span');
  dim.className = 'page-sheet-dim';
  dim.textContent = `${metrics.pageSize.toUpperCase()} · ${metrics.pageWidthMm}×${metrics.pageHeightMm}mm`;
  header.appendChild(dim);

  sheet.appendChild(header);

  const body = document.createElement('div');
  body.className = 'page-sheet-body';
  sheet.appendChild(body);

  wrap.appendChild(sheet);
  return { wrap, sheet, body, pageNo };
}

/**
 * Calculates page breaks dynamically by probing child element heights inside a hidden DOM sandbox.
 */
export function calculateAndRenderPageBreaks(
  html: string,
  userCss: string,
  pageSize: PageSize,
  container: HTMLElement
): void {
  const metrics = getPageMetrics(pageSize);

  // Hidden probe for measuring real DOM layout heights
  const probe = document.createElement('div');
  probe.className = 'markdown-body page-sheet-card';
  probe.id = 'pdf-measure-root';
  probe.style.cssText = `
    position: absolute; left: -10000px; top: 0; visibility: hidden;
    width: ${metrics.pageWidthMm}mm; height: auto; max-height: none;
    min-height: 0; overflow: visible; padding: ${metrics.padMm}mm;
  `;

  const probeBody = document.createElement('div');
  probeBody.className = 'page-sheet-body';
  probeBody.innerHTML = html;
  probe.appendChild(probeBody);
  document.body.appendChild(probe);

  const measureStyle = document.createElement('style');
  measureStyle.textContent = scopeCSS(userCss, ['#pdf-measure-root']);
  document.head.appendChild(measureStyle);

  const blocks = Array.from(probeBody.children);
  const sheets: RenderedSheet[] = [];
  const markers: HTMLElement[] = [];

  let pageNo = 1;
  let currentSheet = createPageSheet(pageNo, metrics);
  sheets.push(currentSheet);

  let usedHeight = 0;
  const maxAvailableHeight = Math.max(120, metrics.contentHeightPx);

  const startNewPage = (kind: PageBreakKind) => {
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
        startNewPage('manual');
      }
      return;
    }

    const clone = block.cloneNode(true) as HTMLElement;
    const blockRect = block.getBoundingClientRect();
    const blockHeight = blockRect.height;
    const verticalGap = usedHeight > 0 ? 8 : 0;

    if (usedHeight > 0 && usedHeight + verticalGap + blockHeight > maxAvailableHeight) {
      startNewPage('auto');
    }

    currentSheet.body.appendChild(clone);
    usedHeight += verticalGap + Math.max(blockHeight, 1);
  });

  // Cleanup probe
  probe.remove();
  measureStyle.remove();

  // Render to target container
  container.innerHTML = '';
  const totalPages = sheets.length;

  sheets.forEach((s, index) => {
    if (index > 0 && markers[index - 1]) {
      container.appendChild(markers[index - 1]);
    }
    const label = s.sheet.querySelector('.page-sheet-label');
    if (label) {
      label.textContent = `Page ${index + 1} of ${totalPages}`;
    }
    container.appendChild(s.wrap);
  });
}
