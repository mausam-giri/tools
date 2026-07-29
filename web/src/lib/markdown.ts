import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(src: string): string {
  const dirty = marked.parse(src || '') as string;
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['data-pagebreak', 'data-break'],
  });
}

export function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

export interface MdSelection {
  start: number;
  end: number;
  value: string;
  selected: string;
}

export function getMdSelection(textarea: HTMLTextAreaElement): MdSelection {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  return {
    start,
    end,
    value: textarea.value,
    selected: textarea.value.slice(start, end),
  };
}

export function setMdSelection(
  textarea: HTMLTextAreaElement,
  nextValue: string,
  cursorStart: number,
  cursorEnd: number
): void {
  textarea.value = nextValue;
  textarea.focus();
  textarea.setSelectionRange(cursorStart, cursorEnd);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string = before,
  placeholder: string = 'text'
): void {
  const { start, end, value, selected } = getMdSelection(textarea);
  const inner = selected || placeholder;
  const next = value.slice(0, start) + before + inner + after + value.slice(end);
  const selStart = start + before.length;
  setMdSelection(textarea, next, selStart, selStart + inner.length);
}

export function prefixLines(
  textarea: HTMLTextAreaElement,
  prefix: string | ((index: number) => string),
  placeholder: string = 'item'
): void {
  const { start, end, value, selected } = getMdSelection(textarea);
  const block = selected || placeholder;
  const lined = block
    .split('\n')
    .map((line, i) => {
      const p = typeof prefix === 'function' ? prefix(i) : prefix;
      return line.match(/^\s*$/) ? line : `${p}${line}`;
    })
    .join('\n');
  const next = value.slice(0, start) + lined + value.slice(end);
  setMdSelection(textarea, next, start, start + lined.length);
}

export function insertBlock(
  textarea: HTMLTextAreaElement,
  block: string,
  selectOffset: number = 0,
  selectLen: number = 0
): void {
  const { start, end, value } = getMdSelection(textarea);
  const needsLead = start > 0 && value[start - 1] !== '\n' ? '\n\n' : start > 0 ? '\n' : '';
  const needsTrail = end < value.length && value[end] !== '\n' ? '\n\n' : '\n';
  const chunk = needsLead + block + needsTrail;
  const next = value.slice(0, start) + chunk + value.slice(end);
  const selStart = start + needsLead.length + selectOffset;
  setMdSelection(textarea, next, selStart, selStart + selectLen);
}

export function applyMarkdownAction(textarea: HTMLTextAreaElement, action: string): void {
  switch (action) {
    case 'bold':
      wrapSelection(textarea, '**', '**', 'bold text');
      break;
    case 'italic':
      wrapSelection(textarea, '*', '*', 'italic text');
      break;
    case 'strike':
      wrapSelection(textarea, '~~', '~~', 'strikethrough');
      break;
    case 'highlight':
      wrapSelection(textarea, '<mark>', '</mark>', 'highlighted');
      break;
    case 'h1':
      prefixLines(textarea, '# ', 'Heading 1');
      break;
    case 'h2':
      prefixLines(textarea, '## ', 'Heading 2');
      break;
    case 'h3':
      prefixLines(textarea, '### ', 'Heading 3');
      break;
    case 'h4':
      prefixLines(textarea, '#### ', 'Heading 4');
      break;
    case 'link': {
      const { selected } = getMdSelection(textarea);
      const label = selected || 'link text';
      wrapSelection(textarea, '[', '](https://)', label);
      break;
    }
    case 'image':
      insertBlock(textarea, '![alt text](https://)', 2, 8);
      break;
    case 'code':
      wrapSelection(textarea, '`', '`', 'code');
      break;
    case 'codeblock':
      insertBlock(textarea, '```js\ncode\n```', 6, 4);
      break;
    case 'quote':
      prefixLines(textarea, '> ', 'quote');
      break;
    case 'ul':
      prefixLines(textarea, '- ', 'item');
      break;
    case 'ol':
      prefixLines(textarea, (i) => `${i + 1}. `, 'item');
      break;
    case 'task':
      prefixLines(textarea, '- [ ] ', 'task');
      break;
    case 'table':
      insertBlock(
        textarea,
        '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| A | B | C |\n| D | E | F |',
        2,
        8
      );
      break;
    case 'hr':
      insertBlock(textarea, '---');
      break;
    case 'pagebreak':
      insertBlock(textarea, '<div data-pagebreak></div>');
      break;
    case 'footnote':
      insertBlock(textarea, 'Here is a footnote reference[^1].\n\n[^1]: Footnote definition.', 28, 2);
      break;
    case 'toc':
      insertBlock(
        textarea,
        '## Table of Contents\n\n- [Section](#section)\n- [Another](#another)',
        5,
        16
      );
      break;
    default:
      break;
  }
}
