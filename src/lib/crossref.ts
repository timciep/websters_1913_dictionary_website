import { slugify } from './slug.js';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Render a definition string (which may contain `<er>...</er>` cross-reference
 * tags) to HTML. Cross-refs that resolve to a known slug become anchors;
 * unknown ones render as plain italic text.
 */
export function renderDefinition(def: string, knownSlugs: Set<string>): string {
  // Split on <er>...</er> while keeping the inner text. We escape the
  // surrounding non-er text and the inner text separately.
  const parts: string[] = [];
  const re = /<er>([\s\S]*?)<\/er>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(def)) !== null) {
    if (m.index > lastIndex) {
      parts.push(escapeHtml(def.slice(lastIndex, m.index)));
    }
    const target = m[1];
    const slug = slugify(target);
    if (slug && knownSlugs.has(slug)) {
      parts.push(`<a class="xref" href="/word/${slug}/">${escapeHtml(target)}</a>`);
    } else {
      parts.push(`<i>${escapeHtml(target)}</i>`);
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < def.length) {
    parts.push(escapeHtml(def.slice(lastIndex)));
  }
  return parts.join('');
}
