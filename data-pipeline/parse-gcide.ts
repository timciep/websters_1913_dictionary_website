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
  number?: string; // top-level sense number from <sn>, e.g. "1.", "2."
  subSense?: string; // sub-sense letter from <sd>, e.g. "(a)", "(b)" — for multi-def blocks
  field?: string; // domain label from <fld>, e.g. "(Bot.)", "(Astron.)"
  definition: string; // may contain <er>...</er> and <i>...</i>; everything else stripped
  quotations: { text: string; author?: string }[]; // text may contain <i>...</i>
  usage?: string; // expanded <mark> label, e.g. "Obsolete", "Provincial English"
  attribution?: string; // <rj><au> following a def with no inline quote
  source?: string; // e.g. "1913 Webster", "PJC", "WordNet 1.5"
}

export interface CollocationDef {
  subSense?: string; // (a) / (b) when a single collocation has multiple <cd> blocks
  definition: string; // postProcessed; may contain <er>, <i>
  quotations: { text: string; author?: string }[];
  attribution?: string; // <au> not paired with an inline quote
  usage?: string; // expanded <mark>, e.g. "Obsolete"
}

export interface Collocation {
  terms: string[]; // one or more variant spellings sharing one definition (from <mcol>)
  field?: string; // domain label, e.g. "(Cookery)"
  defs: CollocationDef[];
  source?: string; // primary source of the surrounding <p> block, e.g. "PJC"
}

export interface RawEntry {
  headwords: string[]; // canonical forms from <ent> (may be more than one — variant spellings)
  displayHeadword: string; // pretty form from <hw>, with stress marks
  pronunciation?: string;
  partOfSpeech?: string;
  etymology?: string;
  senses: Sense[];
  // editorial notes; HTML may contain <i>. `afterSenseIndex` is the count of
  // senses present at the start of the <p> block where this note appeared, so
  // the renderer can place it at its source position relative to senses.
  notes?: { text: string; source?: string; forPhrases?: boolean; afterSenseIndex?: number }[];
  collocations?: Collocation[]; // compound sub-entries from <cs>/<col>/<cd>
  // Position (in senses-rendered-so-far) of the first <cs> block, so the
  // Phrases bundle can render at its source position rather than always at the end.
  phrasesAfterSenseIndex?: number;
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

// GCIDE tags whose contents should render in italics (matching the typography
// of the printed Webster's 1913). All are normalised to <i>...</i> after the
// tag-strip pass so downstream consumers only need to handle a single form.
//   <ex>/<xex>/<qex>  example word inside a definition or quote
//   <spn>             scientific name (Latin binomial)
//   <ets>             etymon (source word in etymology brackets)
//   <grk>             Greek (or other non-Latin) word
//   <it>              explicit italic
//   <altname>/<altsp> alternative name / spelling
const ITALIC_TAGS = new Set(['ex', 'xex', 'qex', 'spn', 'ets', 'grk', 'it', 'altname', 'altsp']);

function rewriteTags(s: string, keep: Set<string>, italic: Set<string>): string {
  return s.replace(/<\/?([A-Za-z][A-Za-z0-9]*)([^>]*)>/g, (m, name: string) => {
    if (italic.has(name)) return m.startsWith('</') ? '</i>' : '<i>';
    if (keep.has(name)) return m;
    return '';
  });
}

/** Like clean(), but converts <br/ sentinels to newlines (for verse/poetry)
 *  and preserves italic markup as <i>...</i> spans. */
function cleanQuote(s: string): string {
  const rewritten = rewriteTags(s, new Set(), ITALIC_TAGS);
  return normalizeWhitespace(decodeXmlEscapes(rewritten))
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
  // Source attribution for the whole block. GCIDE marks each block with one or
  // more <source>...</source> tags. Pick the first non-"+" source as the
  // primary attribution ("+PJC" means "edited by PJC", not "authored by").
  const sources = allTags(block, 'source').map((s) => s.trim());
  const primarySource = sources.find((s) => s && !s.startsWith('+')) ?? sources[0];

  // Snapshot the sense count BEFORE this block contributes anything. Notes and
  // the Phrases bundle anchor to this index so the renderer can interleave them
  // between the senses that came before and the senses (if any) added below.
  const senseIndex = entry.senses.length;

  // <note> blocks carry editorial commentary (e.g. the Gender entry's discussion
  // of historical sex/gender usage). They can appear either as their own
  // continuation paragraph or alongside a sense — collect them either way, and
  // tag each with the surrounding block's source so the renderer can flag
  // modern (PJC, WordNet) notes the same way it flags modern senses.
  //
  // A note block that follows the collocations section (no <def>/<cs> of its
  // own, with collocations already accumulated on the entry) is a continuation
  // of that section — e.g. the "word square" example for the Word entry.
  // Tag those so the renderer can render them inside the Phrases details.
  const noteFollowsCs =
    !!entry.collocations?.length && !/<def>/.test(block) && !/<cs>/.test(block);
  for (const noteBody of allTags(block, 'note')) {
    const text = postProcessDef(noteBody);
    if (text) {
      entry.notes ??= [];
      entry.notes.push({
        text,
        source: primarySource || undefined,
        forPhrases: noteFollowsCs || undefined,
        afterSenseIndex: senseIndex,
      });
    }
  }

  // <cs>...</cs> = collocation section; one or more compound sub-entries
  // (<col><b>term</b></col>, <cd>definition</cd>) attached to this headword.
  for (const csBody of allTags(block, 'cs')) {
    const cols = parseCollocations(csBody);
    if (cols.length > 0) {
      entry.collocations ??= [];
      if (entry.phrasesAfterSenseIndex === undefined) {
        entry.phrasesAfterSenseIndex = senseIndex;
      }
      for (const c of cols) {
        if (primarySource) c.source = primarySource;
        entry.collocations.push(c);
      }
    }
  }

  const sn = firstTag(block, 'sn');
  const fld = firstTag(block, 'fld');
  const defs = collectDefs(block);

  // Standard <q>...</q> quotations.
  const quotations: { text: string; author?: string }[] = allTags(block, 'q').map((qBlock) => ({
    text: cleanQuote(qBlock),
  }));
  const qauAuthors = allTags(block, 'qau').map((s) => clean(s));
  for (let i = 0; i < quotations.length && i < qauAuthors.length; i++) {
    if (qauAuthors[i]) quotations[i].author = qauAuthors[i];
  }

  // The remaining extractions (inline “…” citations, bare <au> attributions,
  // <mark> usage labels) only make sense for sense-bearing blocks. Other
  // blocks like <syn>, <note>, <cs> may contain typographic quotes or `<au>`
  // references as part of editorial prose, and we don't want to misattribute
  // those to the previous sense.
  let attribution: string | undefined;
  let usage: string | undefined;
  if (defs.length > 0) {
    // Strip the def bodies and any <q> bodies so we don't pick up quotes that
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

  if (defs.length > 0) {
    // Multi-def blocks (with <sd>(a)</sd> sub-sense markers) become multiple
    // senses. Quotations / usage / attribution attach to the LAST sub-sense
    // (close enough to source order in practice). The parent <sn> sits on
    // the first sub-sense; the <fld> domain label is shared by all.
    const baseField = fld ? clean(fld) : undefined;
    const lastIdx = defs.length - 1;
    defs.forEach(({ sd, def }, i) => {
      entry.senses.push({
        number: i === 0 && sn ? clean(sn) : undefined,
        subSense: sd ? clean(sd) : undefined,
        field: baseField,
        definition: postProcessDef(def),
        quotations: i === lastIdx ? quotations : [],
        usage: i === lastIdx ? usage : undefined,
        attribution: i === lastIdx ? attribution : undefined,
        source: primarySource || undefined,
      });
    });
  } else if (quotations.length > 0 && entry.senses.length > 0) {
    // Quotation block attached to the previous sense.
    entry.senses[entry.senses.length - 1].quotations.push(...quotations);
  }
}

// Walk a block sequentially, pairing each <def>...</def> with the most recent
// preceding <sd>...</sd> (sub-sense marker, e.g. "(a)", "(b)"). Single-def
// blocks return one entry with sd=undefined.
function collectDefs(block: string): { sd?: string; def: string }[] {
  const re = /<(sd|def)>([\s\S]*?)<\/\1>/g;
  const out: { sd?: string; def: string }[] = [];
  let pendingSd: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (m[1] === 'sd') {
      pendingSd = m[2];
    } else {
      out.push({ sd: pendingSd, def: m[2] });
      pendingSd = undefined;
    }
  }
  return out;
}

function postProcessDef(def: string): string {
  // GCIDE occasionally omits whitespace between a short abbreviation and an
  // immediately-following inline tag, producing "F.<ets>genre</ets>" or
  // "Cf.<er>Foo</er>" — which otherwise render as "F.genre" / "Cf.Foo".
  // Insert the space before tag rewriting collapses the markup boundary.
  const spaced = def.replace(
    /(\b[A-Z][a-z]?\.)(<(?:ets|er|it|ex|xex|qex|spn|grk|altname|altsp)>)/g,
    '$1 $2',
  );
  // Preserve <er>...</er> tags (the renderer linkifies them) and italicize
  // the GCIDE typography tags by rewriting them to <i>...</i>. Strip the rest.
  const rewritten = rewriteTags(spaced, new Set(['er']), ITALIC_TAGS);
  return normalizeWhitespace(decodeXmlEscapes(rewritten)).replace(/\s+([,.;:!?])/g, '$1');
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

// ---------- collocations ----------
//
// A <cs>...</cs> block holds one or more compound sub-entries. Each unit looks
// like one of:
//   <col><b>Term</b></col>, <cd>def</cd>
//   <col><b>Term</b></col> <fld>(Bot.)</fld>, <cd>def</cd>
//   <mcol><col><b>T1</b></col> <it>or</it> <col><b>T2</b></col></mcol>, <cd>def</cd>
//   <col><b>Term</b></col>, <sd>(a)</sd> <cd>def1</cd> <sd>(b)</sd> <cd>def2</cd>
// Multiple units within one <cs> are separated by " -- " in the source.

export function parseCollocations(cs: string): Collocation[] {
  // Step 1: locate "unit boundaries". A new unit starts at every <mcol> and at
  // every <col> that is NOT enclosed in an <mcol> (those <col>s are variant
  // term spellings sharing a single definition).
  const mcolRanges: { start: number; end: number }[] = [];
  for (const m of cs.matchAll(/<mcol>[\s\S]*?<\/mcol>/g)) {
    mcolRanges.push({ start: m.index!, end: m.index! + m[0].length });
  }
  const inMcol = (i: number) => mcolRanges.some((r) => i >= r.start && i < r.end);

  const starters: number[] = mcolRanges.map((r) => r.start);
  for (const m of cs.matchAll(/<col>/g)) {
    if (!inMcol(m.index!)) starters.push(m.index!);
  }
  starters.sort((a, b) => a - b);

  const units: string[] = [];
  for (let i = 0; i < starters.length; i++) {
    const end = i + 1 < starters.length ? starters[i + 1] : cs.length;
    units.push(cs.slice(starters[i], end));
  }

  return units.map(parseCollocationUnit).filter((c): c is Collocation => c !== null);
}

function parseCollocationUnit(unit: string): Collocation | null {
  // Term(s) — every <col>...</col> in this unit, including those grouped in <mcol>.
  const terms: string[] = [];
  for (const m of unit.matchAll(/<col>([\s\S]*?)<\/col>/g)) {
    const t = clean(m[1]);
    if (t) terms.push(t);
  }
  if (terms.length === 0) return null;

  const fldMatch = unit.match(/<fld>([\s\S]*?)<\/fld>/);
  const field = fldMatch ? clean(fldMatch[1]) : undefined;

  // Walk through (sd? cd) pairs. Each cd's "tail" runs to the next match start,
  // so quotations / authors / usage labels attach to the def they follow.
  const cdRe = /(?:<sd>([\s\S]*?)<\/sd>\s*)?<cd>([\s\S]*?)<\/cd>/g;
  const cdMatches: { sd?: string; def: string; matchEnd: number; tailEnd: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = cdRe.exec(unit)) !== null) {
    cdMatches.push({
      sd: m[1],
      def: m[2],
      matchEnd: m.index + m[0].length,
      tailEnd: unit.length,
    });
  }
  if (cdMatches.length === 0) return null;
  for (let i = 0; i < cdMatches.length - 1; i++) {
    // Tail ends where the next match begins. Reconstruct that from the next
    // match's recorded end minus its own match length — easier to just rerun
    // the regex once more, but since we have matchEnd in order, the next
    // tailEnd is simply the next match's full-match start position. Recompute
    // by scanning ahead from the previous matchEnd.
    const slice = unit.slice(cdMatches[i].matchEnd);
    const nextMatch = /(?:<sd>[\s\S]*?<\/sd>\s*)?<cd>/.exec(slice);
    cdMatches[i].tailEnd = nextMatch ? cdMatches[i].matchEnd + nextMatch.index : unit.length;
  }

  const defs: CollocationDef[] = cdMatches.map((c) => {
    const tail = unit.slice(c.matchEnd, c.tailEnd);

    const quotations: { text: string; author?: string }[] = [];
    for (const qm of tail.matchAll(/“([\s\S]+?)”/g)) {
      const text = cleanQuote(qm[1]);
      if (text) quotations.push({ text });
    }
    const tailAuthors = Array.from(tail.matchAll(/<au>([\s\S]*?)<\/au>/g)).map((am) => clean(am[1]));
    for (let j = 0; j < quotations.length && j < tailAuthors.length; j++) {
      if (tailAuthors[j]) quotations[j].author = tailAuthors[j];
    }
    const attribution =
      tailAuthors.length > quotations.length ? tailAuthors[quotations.length] : undefined;

    const tailMarks = Array.from(tail.matchAll(/<mark>([\s\S]*?)<\/mark>/g)).map((am) =>
      clean(am[1]),
    );
    const usage = tailMarks.length > 0 ? expandUsageMarkers(tailMarks) : undefined;

    return {
      subSense: c.sd ? clean(c.sd) : undefined,
      definition: postProcessDef(c.def),
      quotations,
      attribution,
      usage,
    };
  });

  return { terms, field, defs };
}
