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
// shorthands that also crop up inside definitions.
//
// Single-letter language codes (F., L., G., E., D., W.) collide with
// author initials, "D.C.", "Sp. gr." (specific gravity), Fahrenheit
// ("100° F."), and end-of-sentence captures. We match them only inside
// an open etymology bracket — lookbehind `\[[^\]]*` requires a preceding
// `[` with no intervening `]` — and reject anything followed by
// `\s*[A-Z]` to skip both initials ("F. M. Smith") and adjacent-capital
// runs ("D.C."). This loses a handful of stray language refs in
// free-prose definitions (e.g. "(5) French à (L. ad)") but keeps every
// false-positive context out. Sp. (Spanish) is multi-letter and could
// be added similarly, but stays out for now: "Sp. gr." (specific
// gravity) appears in definitions, not etymology brackets, so the
// bracket gate would already cover it — fine to revisit if needed.
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
  [/(?<=\[[^\]]*)\bF\.(?!\s*[A-Z])/g, 'French'],
  [/(?<=\[[^\]]*)\bL\.(?!\s*[A-Z])/g, 'Latin'],
  [/(?<=\[[^\]]*)\bG\.(?!\s*[A-Z])/g, 'German'],
  [/(?<=\[[^\]]*)\bE\.(?!\s*[A-Z])/g, 'English'],
  [/(?<=\[[^\]]*)\bD\.(?!\s*[A-Z])/g, 'Dutch'],
  [/(?<=\[[^\]]*)\bW\.(?!\s*[A-Z])/g, 'Welsh'],
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

// GCIDE cross-references sometimes carry `{N}` or `[tag]` suffixes for
// homograph disambiguation. Our site merges homographs onto one page, so
// we strip these before slug lookup.
const SUFFIX_RE = /[\{\[].+$/;

// GCIDE contains misspelled cross-references. Rather than patching vendor
// data, correct the slugs at render time.
const SLUG_CORRECTIONS: Record<string, string> = {
  // Typos in source
  achorman: 'anchorman',
  agilops: 'aegilops',
  antocians: 'antecians',
  ascoccus: 'ascococcus',
  baddrelocks: 'badderlocks',
  bodick: 'bodice',
  brachmanic: 'brahmanic',
  brokkerage: 'brokerage',
  bucketfull: 'bucketful',
  'carboxyl-gorup': 'carboxyl-group',
  carpaphore: 'carpophore',
  casarian: 'caesarean',
  chaceleon: 'chameleon',
  cheesparing: 'cheeseparing',
  convolvuln: 'convolvulin',
  corriestep: 'corbiestep',
  corrundum: 'corundum',
  corundun: 'corundum',
  'cruclan-carp': 'crucian-carp',
  epycycloid: 'epicycloid',
  eychroic: 'euchroic',
  feullemort: 'feuillemort',
  ganoidel: 'ganoidei',
  glutaus: 'gluteus',
  gobulin: 'globulin',
  hoocephali: 'holocephali',
  hoookah: 'hookah',
  ichthvophthira: 'ichthyophthira',
  intercolumnlation: 'intercolumniation',
  lambus: 'iambus',
  legislatature: 'legislature',
  mycropyle: 'micropyle',
  nonoclinal: 'monoclinal',
  otrthopedic: 'orthopedic',
  persinogen: 'pepsinogen',
  rapscalion: 'rapscallion',
  'ratched-wheel': 'ratchet',
  sloough: 'slough',
  specsioneer: 'specksioneer',
  yellolegs: 'yellowlegs',
  // Hyphenation / spacing variants
  acornshell: 'acorn-shell',
  'army-worm': 'armyworm',
  'black-list': 'blacklist',
  'black-cap': 'blackcap',
  'breast-wheel': 'breastwheel',
  'bush-buck': 'bushbuck',
  'deacon-ship': 'deaconship',
  'gilly-flower': 'gillyflower',
  'moor-fowl': 'moorfowl',
  'toad-flax': 'toadflax',
  woadwaxen: 'woad-waxen',
  // Alternate spellings where the target exists under a different form
  'angostura-bark': 'angustura-bark',
  dextrotatory: 'dextrorotatory',
  highfaluting: 'highfalutin',
  mammillated: 'mamillated',
  ridgelling: 'ridgeling',
  tagliacotian: 'taliacotian',
};

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
    // Strip GCIDE homograph suffixes like {2} or [wn1]
    const cleaned = target.replace(SUFFIX_RE, '').trim();
    let slug = slugify(cleaned);
    let corrected = false;
    if (slug && !knownSlugs.has(slug) && SLUG_CORRECTIONS[slug]) {
      slug = SLUG_CORRECTIONS[slug];
      corrected = true;
    }
    if (slug && knownSlugs.has(slug)) {
      const correction = corrected
        ? ` <span class="xref-corrected" tabindex="0" data-expand="Corrected from &quot;${escapeHtml(target)}&quot;">&lowast;</span>`
        : '';
      parts.push(`<a class="xref" href="/word/${slug}/">${escapeHtml(cleaned)}</a>${correction}`);
    } else {
      parts.push(`<i>${escapeHtml(cleaned)}</i>`);
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < def.length) {
    parts.push(annotateAbbrs(escapeHtml(def.slice(lastIndex))));
  }
  return parts.join('');
}
