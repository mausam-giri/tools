import type { PageSize } from './types';
import { renderMarkdown } from './markdown';
import { scopeCSS } from './css-scoper';
import { PDF_MARGIN_MM } from './page-break';

// Declare html2pdf loaded globally from script/bundle
declare const html2pdf: any;

export async function exportToPDF(
  markdownSrc: string,
  userCss: string,
  pageSize: PageSize,
  exportBtn?: HTMLButtonElement | null
): Promise<void> {
  if (exportBtn) exportBtn.disabled = true;

  const format = pageSize === 'letter' ? 'letter' : 'a4';
  const pageWidth = pageSize === 'letter' ? '215.9mm' : '210mm';

  const clone = document.createElement('article');
  clone.id = 'pdf-export-root';
  clone.className = 'markdown-body page-sheet';
  clone.style.width = pageWidth;
  clone.style.minHeight = 'auto';
  clone.style.boxShadow = 'none';
  clone.style.borderRadius = '0';
  clone.style.margin = '0';
  clone.style.padding = '0';
  clone.innerHTML = renderMarkdown(markdownSrc);

  const mount = document.createElement('div');
  mount.style.position = 'fixed';
  mount.style.left = '-10000px';
  mount.style.top = '0';
  mount.style.width = pageWidth;
  mount.appendChild(clone);

  const style = document.createElement('style');
  style.textContent = scopeCSS(userCss, ['#pdf-export-root']);
  mount.appendChild(style);
  document.body.appendChild(mount);

  const opt = {
    margin: [PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_MARGIN_MM],
    filename: 'markforge-document.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    },
    jsPDF: { unit: 'mm', format, orientation: 'portrait' },
    pagebreak: {
      mode: ['css', 'legacy'],
      after: '[data-pagebreak], [data-break="page"], .page-break',
      avoid: ['img', 'pre', 'table', 'blockquote'],
    },
  };

  try {
    await html2pdf().set(opt).from(clone).save();
  } catch (err) {
    console.error('PDF export failed:', err);
    alert('PDF export failed. Please check document content or try again.');
  } finally {
    mount.remove();
    if (exportBtn) exportBtn.disabled = false;
  }
}
