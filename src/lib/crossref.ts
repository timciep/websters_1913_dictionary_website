import { slugify } from './slug.js';
import { expandPos } from './pos.js';

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

// Wrap stray scholarly abbreviations in <abbr> tooltips. Operates on
// already-escaped HTML text — the replacement contains literal markup, so
// it must run after escapeHtml, never before.
//
// Most entries are language abbreviations from the etymology brackets
// (Webster's 1913 cites cognates in dozens of languages with terse caps).
// A few — Cf., e.g., i.e., viz., Fig., Prob., Pref. — are scholarly
// shorthands that also crop up inside definitions. Single-letter cases
// (F., L., D., G., W., E., Sp.) are deliberately skipped: they collide
// with author initials, "D.C.", "Sp. gr." (specific gravity), Fahrenheit,
// and end-of-sentence captures.
const ABBR_HINTS: Array<[RegExp, string]> = [
  // Scholarly shorthands
  [/\bCf\./g, 'compare'],
  [/\bcf\./g, 'compare'],
  [/\be\.\s?g\./g, 'for example'],
  [/\bi\.\s?e\./g, 'that is'],
  [/\bq\.\s?v\./g, 'which see'],
  [/\bviz\./g, 'namely'],
  [/\bFig\./g, 'figuratively'],
  [/\bProb\./g, 'probably'],
  [/\bPref\./g, 'prefix'],
  [/\bfr\./g, 'from'],
  [/\bv\.\s?t\./g, 'transitive verb'],
  // Language abbreviations (etymology brackets)
  [/\bOF\./g, 'Old French'],
  [/\bOE\./g, 'Old English'],
  [/\bME\./g, 'Middle English'],
  [/\bAS\./g, 'Anglo-Saxon'],
  [/\bLL\./g, 'Late Latin'],
  [/\bNL\./g, 'New Latin'],
  [/\bOL\./g, 'Old Latin'],
  [/\bGr\./g, 'Greek'],
  [/\bOHG\./g, 'Old High German'],
  [/\bMHG\./g, 'Middle High German'],
  [/\bOS\./g, 'Old Saxon'],
  [/\bIcel\./g, 'Icelandic'],
  [/\bGoth\./g, 'Gothic'],
  [/\bSkr\./g, 'Sanskrit'],
  [/\bSkt\./g, 'Sanskrit'],
  [/\bHeb\./g, 'Hebrew'],
  [/\bAr\./g, 'Arabic'],
  [/\bIt\./g, 'Italian'],
  [/\bPg\./g, 'Portuguese'],
  [/\bGer\./g, 'German'],
  [/\bDan\./g, 'Danish'],
  [/\bSw\./g, 'Swedish'],
  [/\bPers\./g, 'Persian'],
  [/\bTurk\./g, 'Turkish'],
  [/\bF\./g, 'French'],
  [/\bL\./g, 'Latin'],
];

// Inflection abbreviations that introduce a "form-of" pointer in cross-
// reference definitions, e.g. "imp. of <er>Run</er>" or "p. p. of <er>See</er>".
// These collide with author initials and end-of-sentence captures in free
// prose, so we only annotate them when followed by " of " — that's the
// canonical GCIDE shape for this kind of stub definition. Longer patterns
// must come before their prefixes so the regex alternation matches them
// greedily.
const INFLECTION_ABBRS = [
  'imp. pl. & p. p.',
  'imp. & p. p.',
  '3d pers. sing. pres.',
  '2d pers. sing. pres.',
  'obs. imp.',
  'imp. pl.',
  'p. pr. & a.',
  'p. pr.',
  'p. p.',
  'imp.',
  'pl.',
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const INFLECTION_RE = new RegExp(
  '(' + INFLECTION_ABBRS.map(escapeRegex).join('|') + ')(?= of )',
  'g',
);

function annotateAbbrs(escaped: string): string {
  let out = escaped;
  for (const [re, expand] of ABBR_HINTS) {
    out = out.replace(
      re,
      (match) =>
        `<abbr class="pos-abbr" tabindex="0" data-expand="${expand}">${match}</abbr>`,
    );
  }
  out = out.replace(INFLECTION_RE, (match) => {
    const expand = expandPos(match);
    if (!expand) return match;
    return `<abbr class="pos-abbr" tabindex="0" data-expand="${expand}">${match}</abbr>`;
  });
  return out;
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
      parts.push(annotateAbbrs(escapeHtml(def.slice(lastIndex, m.index))));
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
    parts.push(annotateAbbrs(escapeHtml(def.slice(lastIndex))));
  }
  return parts.join('');
}
