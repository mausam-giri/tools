/**
 * Scopes raw custom CSS rules so they only affect document preview containers
 * without leaking into the surrounding Markforge UI.
 */
export function scopeCSS(css: string, scopes: string[]): string {
  const scopeList = scopes.join(', ');
  let out = '';
  let i = 0;
  let buf = '';
  let depth = 0;
  let inString: string | null = null;
  let inComment = false;

  const flushRule = (block: string) => {
    const brace = block.indexOf('{');
    if (brace === -1) {
      out += block;
      return;
    }
    const selectors = block.slice(0, brace).trim();
    const body = block.slice(brace);
    if (!selectors || selectors.startsWith('@')) {
      if (selectors.startsWith('@media') || selectors.startsWith('@supports')) {
        const innerStart = body.indexOf('{');
        const innerEnd = body.lastIndexOf('}');
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
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        if (s === 'body' || s === 'html' || s === ':root') {
          return scopeList;
        }
        if (s === '.markdown-body' || s.startsWith('.markdown-body ')) {
          const rest = s === '.markdown-body' ? '' : s.slice('.markdown-body'.length);
          return scopes.map((sc) => `${sc}${rest}`).join(', ');
        }
        return scopes.map((sc) => `${sc} ${s}`).join(', ');
      })
      .join(', ');
    out += `${scoped}${body}`;
  };

  while (i < css.length) {
    const ch = css[i];
    const next = css[i + 1];

    if (inComment) {
      buf += ch;
      if (ch === '*' && next === '/') {
        buf += '/';
        i += 2;
        inComment = false;
        continue;
      }
      i++;
      continue;
    }

    if (inString) {
      buf += ch;
      if (ch === '\\' && next) {
        buf += next;
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      buf += '/*';
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

    if (ch === '{') {
      depth++;
      buf += ch;
      i++;
      continue;
    }

    if (ch === '}') {
      depth--;
      buf += ch;
      i++;
      if (depth === 0) {
        flushRule(buf);
        buf = '';
      }
      continue;
    }

    buf += ch;
    i++;
  }

  if (buf.trim()) out += buf;
  return out;
}
