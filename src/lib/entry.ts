import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Quotation {
  text: string;
  author?: string;
}

export interface Sense {
  number?: string;
  definition: string; // may contain <er>...</er> cross-references
  quotations: Quotation[];
  source?: string; // e.g. "1913 Webster", "PJC", "WordNet 1.5"
}

// One spelling/POS variant of a headword. Multiple forms share a page when
// they're homographs (e.g. `slice` n., `slice` v. t., `slice` v. t. (Golf)).
export interface EntryForm {
  headword: string;
  variants: string[];
  pronunciation?: string;
  partOfSpeech?: string;
  etymology?: string;
  senses: Sense[];
}

export interface EntryPage {
  slug: string;
  headword: string;
  forms: EntryForm[];
}

export interface SearchRow {
  s: string; // slug
  h: string; // headword
  p?: string; // part of speech
  d?: string; // short definition
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const ENTRIES_DIR = path.join(DATA_DIR, 'entries');

let cachedPages: EntryPage[] | null = null;
let cachedSlugs: Set<string> | null = null;

/** Load every entry page from disk. Cached after first call. */
export async function loadAllEntries(): Promise<EntryPage[]> {
  if (cachedPages) return cachedPages;
  const shards = await fs.readdir(ENTRIES_DIR);
  const all: EntryPage[] = [];
  for (const shard of shards) {
    const dir = path.join(ENTRIES_DIR, shard);
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) continue;
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(dir, file), 'utf8');
      all.push(JSON.parse(raw) as EntryPage);
    }
  }
  cachedPages = all;
  return all;
}

/** Set of every slug in the corpus, used by the cross-ref linkifier. */
export async function loadSlugSet(): Promise<Set<string>> {
  if (cachedSlugs) return cachedSlugs;
  const pages = await loadAllEntries();
  cachedSlugs = new Set(pages.map((p) => p.slug));
  return cachedSlugs;
}

/** Read the search index (much smaller than the full entry corpus). */
export async function loadSearchIndex(): Promise<SearchRow[]> {
  const raw = await fs.readFile(path.join(DATA_DIR, 'search-index.json'), 'utf8');
  return JSON.parse(raw) as SearchRow[];
}
