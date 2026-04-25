// Parse GCIDE source files (CIDE.A … CIDE.Z) into structured Entry objects.
//
// GCIDE structure recap:
//   - The file is a stream of <p>...</p> blocks (the closing </p> may be on a
//     later line; we treat <p> as the block boundary).
//   - A new headword group begins with a <p> block containing one or more
//     <ent>HEADWORD</ent> tags. Subsequent <p> blocks (until the next <ent>
//     block) belong to the same headword group as additional senses, quotations,
//     or notes.
//   - Within an entry: <hw> headword (with stress), <pr> pronunciation, <pos>
//     part of speech, <ety> etymology, <def> definition, <sn> sense number,
//     <q> quotation, <qau> quotation author, <er> cross-reference.
//   - Inline entities like <adot/, <amac/, <frac12/ encode special characters.

import { expandEntities } from './entities.js';

export interface Sense {
  number?: string;
  definition: string; // HTML-safe (no <a> yet — that's added later by crossref pass)
  quotations: { text: string; author?: string }[];
  usage?: string; // expanded <mark> label, e.g. "Obsolete", "Provincial English"
  attribution?: string; // <rj><au> following a def with no inline quote
  source?: string; // e.g. "1913 Webster", "PJC", "WordNet 1.5"
}

export interface RawEntry {
  headwords: string[]; // canonical forms from <ent> (may be more than one — variant spellings)
  displayHeadword: string; // pretty form from <hw>, with stress marks
  pronunciation?: string;
  partOfSpeech?: string;
  etymology?: string;
  senses: Sense[];
}

// ---------- helpers ----------

function stripTags(s: string, keep: Set<string> = new Set()): string {
  // Remove start/end tags whose name is NOT in `keep`. Self-closing entity
  // tags (<name/) should already be expanded by expandEntities() before this.
  return s.replace(/<\/?([A-Za-z][A-Za-z0-9]*)([^>]*)>/g, (m, name: string) => {
    return keep.has(name) ? m : '';
  });
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function decodeXmlEscapes(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function clean(s: string): string {
  return normalizeWhitespace(decodeXmlEscapes(stripTags(s)))
    .replace(/\x00BR\x00/g, '') // drop line-break sentinels in non-quote contexts
    .replace(/\s+([,.;:!?])/g, '$1');
}

/** Like clean(), but converts <br/ sentinels to newlines (for verse/poetry). */
function cleanQuote(s: string): string {
  return normalizeWhitespace(decodeXmlEscapes(stripTags(s)))
    .replace(/\s*\x00BR\x00\s*/g, '\n')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

// `(?)` is an editorial shorthand in the GCIDE source meaning "pronounced as
// the headword is spelled." It carries no information for the reader, so drop
// it — and drop the whole `<pr>` if that's all it contained.
function cleanPronunciation(pr: string | undefined): string | undefined {
  if (!pr) return undefined;
  const stripped = clean(pr).replace(/\(\?\)/g, '').replace(/\s+/g, ' ').trim();
  return stripped.length > 0 ? stripped : undefined;
}

// Extract text content of the FIRST occurrence of <tag>...</tag>.
function firstTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = block.match(re);
  return m ? m[1] : undefined;
}

// Extract text content of ALL occurrences of <tag>...</tag>.
function allTags(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out.push(m[1]);
  return out;
}

// ---------- splitting into <p> blocks ----------

function splitParagraphs(text: string): string[] {
  // Each <p>...</p> may span lines. They don't nest.
  const blocks: string[] = [];
  const re = /<p>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

// ---------- main parser ----------

export function parseGcideFile(raw: string): RawEntry[] {
  // 1. Expand all `<name/` entities to UTF-8 first.
  const text = expandEntities(raw);

  // 2. Split into <p> blocks.
  const blocks = splitParagraphs(text);

  const entries: RawEntry[] = [];
  let current: RawEntry | null = null;

  for (const block of blocks) {
    const hasEnt = /<ent>/.test(block);

    if (hasEnt) {
      // Start a new entry. (Push previous one first.)
      if (current) entries.push(current);
      const headwords = allTags(block, 'ent').map((s) => clean(s));
      const hw = firstTag(block, 'hw');
      const pr = firstTag(block, 'pr');
      const pos = firstTag(block, 'pos');
      const ety = firstTag(block, 'ety');
      current = {
        headwords,
        displayHeadword: hw ? clean(hw) : headwords[0] ?? '',
        pronunciation: cleanPronunciation(pr),
        partOfSpeech: pos ? clean(pos) : undefined,
        etymology: ety ? postProcessDef(ety) : undefined,
        senses: [],
      };
      // Some <ent> blocks ALSO contain a first sense / definition.
      pushSenseFromBlock(block, current);
    } else if (current) {
      // Continuation block — additional sense or quotation for the current entry.
      pushSenseFromBlock(block, current);
    }
    // Blocks before the first <ent> are dropped (file headers, etc.).
  }
  if (current) entries.push(current);

  // Filter out empty/garbage entries.
  return entries.filter((e) => e.headwords.length > 0 && e.headwords[0].length > 0);
}

function pushSenseFromBlock(block: string, entry: RawEntry): void {
  const sn = firstTag(block, 'sn');
  const def = firstTag(block, 'def');

  // Standard <q>...</q> quotations.
  const quotations: { text: string; author?: string }[] = allTags(block, 'q').map((qBlock) => ({
    text: cleanQuote(qBlock),
  }));
  const qauAuthors = allTags(block, 'qau').map((s) => clean(s));
  for (let i = 0; i < quotations.length && i < qauAuthors.length; i++) {
    if (qauAuthors[i]) quotations[i].author = qauAuthors[i];
  }

  // The remaining extractions (inline “…” citations, bare <au> attributions,
  // <mark> usage labels) only make sense for sense-bearing blocks (those with
  // a <def>). Other blocks like <syn>, <note>, <cs> may contain typographic
  // quotes or `<au>` references as part of editorial prose, and we don't want
  // to misattribute those to the previous sense.
  let attribution: string | undefined;
  let usage: string | undefined;
  if (def) {
    // Strip the def body (and any <q> body) so we don't pick up quotes that
    // legitimately appear inside def prose.
    const tail = block
      .replace(/<def>[\s\S]*?<\/def>/g, '')
      .replace(/<q>[\s\S]*?<\/q>/g, '');

    // Inline citation quotes: many entries use <ldquo/.../<rdquo/ + trailing
    // <au> (often wrapped in <rj>) instead of the formal <q>/<qau> structure.
    // After expandEntities those entity tags are already U+201C / U+201D.
    const inlineQuotes: { text: string; author?: string }[] = [];
    for (const m of tail.matchAll(/“([\s\S]+?)”/g)) {
      const text = cleanQuote(m[1]);
      if (text) inlineQuotes.push({ text });
    }
    const tailAuthors = Array.from(tail.matchAll(/<au>([\s\S]*?)<\/au>/g)).map((m) =>
      clean(m[1]),
    );
    for (let i = 0; i < inlineQuotes.length && i < tailAuthors.length; i++) {
      if (tailAuthors[i]) inlineQuotes[i].author = tailAuthors[i];
    }
    quotations.push(...inlineQuotes);
    // Leftover author with no inline quote → sense-level attribution
    // (e.g. <def>A gabeler.</def> <rj><au>Carlyle.</au></rj>).
    if (tailAuthors.length > inlineQuotes.length) {
      attribution = tailAuthors[inlineQuotes.length];
    }

    // Usage label(s) from <mark>…</mark>. Expand abbreviations
    // (Obs. → Obsolete, Prov. Eng. → Provincial English, …).
    const usageMarks = Array.from(tail.matchAll(/<mark>([\s\S]*?)<\/mark>/g)).map((m) =>
      clean(m[1]),
    );
    if (usageMarks.length > 0) usage = expandUsageMarkers(usageMarks);
  }

  // Extract source attribution(s) from the block. GCIDE marks each block with
  // one or more <source>...</source> tags. We pick the first non-"+" source as
  // the primary attribution ("+PJC" means "edited by PJC", not "authored by").
  const sources = allTags(block, 'source').map((s) => s.trim());
  const primarySource = sources.find((s) => s && !s.startsWith('+')) ?? sources[0];

  if (def) {
    entry.senses.push({
      number: sn ? clean(sn) : undefined,
      // Keep <er> tags so the crossref pass can linkify them; strip everything else.
      definition: postProcessDef(def),
      quotations,
      usage,
      attribution,
      source: primarySource || undefined,
    });
  } else if (quotations.length > 0 && entry.senses.length > 0) {
    // Quotation block attached to the previous sense.
    entry.senses[entry.senses.length - 1].quotations.push(...quotations);
  }
}

function postProcessDef(def: string): string {
  // Preserve <er>...</er> tags (cross references), strip everything else.
  const keep = new Set(['er']);
  return normalizeWhitespace(decodeXmlEscapes(stripTags(def, keep))).replace(
    /\s+([,.;:!?])/g,
    '$1',
  );
}

// Expansions for GCIDE usage abbreviations found inside <mark>…</mark>. Most
// abbreviations have a trailing period in source, but a small minority don't
// (e.g. `<mark>Fig</mark>.` puts the period outside the tag). The matcher
// uses lookbehind/lookahead to anchor on letter boundaries, so we list both
// dotted and bare forms where they occur. Apply longest keys first so e.g.
// `Prov. Eng.` resolves before `Eng.`.
const USAGE_EXPANSIONS: Record<string, string> = {
  // Status / register
  'Obs.': 'Obsolete',
  'Obs': 'Obsolete',
  'obs.': 'obsolete',
  'obs': 'obsolete',
  'Obsoles.': 'Obsolescent',
  'Archaic.': 'Archaic',
  'R.': 'Rare',
  'Colloq.': 'Colloquial',
  'Colloq': 'Colloquial',
  'colloq.': 'colloquial',
  'Coloq.': 'Colloquial',
  'Inform.': 'Informal',
  'Hist.': 'Historical',
  'Dial.': 'Dialectal',
  'Fig.': 'Figurative',
  'Fig': 'Figurative',
  'fig.': 'figurative',
  'fig': 'figurative',
  'Derog.': 'Derogatory',
  'derog.': 'derogatory',
  'Abbrev.': 'Abbreviation',
  'abbr.': 'abbreviation',
  // Regional
  'Prov. Eng.': 'Provincial English',
  'Great Brit.': 'Great Britain',
  'Eng.': 'English',
  'Engl.': 'English',
  'Scot.': 'Scottish',
  'Brit.': 'British',
  'U. S.': 'United States',
  'U.S.': 'United States',
};

function expandUsageMarkers(marks: string[]): string {
  const expanded = marks
    .map((m) => expandUsageString(m.replace(/^[\[({]+|[\])}]+$/g, '').trim()))
    .filter((s) => s.length > 0);
  return Array.from(new Set(expanded)).join('; ');
}

function expandUsageString(s: string): string {
  let out = s;
  const sorted = Object.keys(USAGE_EXPANSIONS).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Letter boundaries on both sides: keeps `R.` from matching inside `Mr.`,
    // and keeps bare `Fig` from matching inside `Figure`.
    out = out.replace(
      new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'g'),
      USAGE_EXPANSIONS[key],
    );
  }
  return out;
}
