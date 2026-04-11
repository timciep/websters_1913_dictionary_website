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
  return normalizeWhitespace(decodeXmlEscapes(stripTags(s))).replace(/\s+([,.;:!?])/g, '$1');
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
        pronunciation: pr ? clean(pr) : undefined,
        partOfSpeech: pos ? clean(pos) : undefined,
        etymology: ety ? clean(ety) : undefined,
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
  // Quotations may appear in the same block as the def, or in their own block.
  const quotations = allTags(block, 'q').map((qBlock) => {
    // qau (author) may appear OUTSIDE the <q>...</q> in the same paragraph.
    return { text: clean(qBlock) };
  });
  // Look for authors in the surrounding block (after the </q>).
  const authorMatches = allTags(block, 'qau').map((s) => clean(s));
  if (authorMatches.length > 0 && quotations.length > 0) {
    // Pair them up positionally.
    for (let i = 0; i < quotations.length; i++) {
      if (authorMatches[i]) quotations[i].author = authorMatches[i];
    }
  }

  if (def) {
    entry.senses.push({
      number: sn ? clean(sn) : undefined,
      // Keep <er> tags so the crossref pass can linkify them; strip everything else.
      definition: postProcessDef(def),
      quotations,
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
