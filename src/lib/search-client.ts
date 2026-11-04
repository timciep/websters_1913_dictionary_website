// Client-side headword search shared by the autocomplete box (SearchBox.astro)
// and the full results page (pages/search.astro). Loads /search-index.json
// once per page, builds a MiniSearch index, and ranks hits the same way in
// both places so the dropdown and the results page always agree.
import MiniSearch from 'minisearch';
import { slugify } from './slug';

export interface SearchRow {
  s: string; // slug
  h: string; // headword (display form)
  p?: string; // part(s) of speech
}

let loading: Promise<void> | null = null;
let mini: MiniSearch<SearchRow> | null = null;
let slugMap: Map<string, SearchRow> = new Map();

/** Fetch and index the headword list. Safe to call repeatedly. */
export function ensureIndex(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const res = await fetch('/search-index.json');
      if (!res.ok) throw new Error(`search index: HTTP ${res.status}`);
      const rows = (await res.json()) as SearchRow[];
      slugMap = new Map(rows.map((r) => [r.s, r]));
      const m = new MiniSearch<SearchRow>({
        idField: 's',
        fields: ['h'],
        storeFields: ['s', 'h', 'p'],
        searchOptions: {
          prefix: true,
          fuzzy: 0.15,
          boost: { h: 2 },
          // MiniSearch defaults rank fuzzy (0.45) above prefix (0.375), so a 1-edit
          // fuzzy match beats a 1-char prefix extension — "gende" surfaces "genie"
          // ahead of "gender". Bias toward prefix; keep fuzzy as a typo fallback.
          weights: { prefix: 1, fuzzy: 0.1 },
        },
      });
      m.addAll(rows);
      mini = m;
    })().catch((err) => {
      loading = null; // allow a retry on the next call
      throw err;
    });
  }
  return loading;
}

export function isIndexReady(): boolean {
  return mini !== null;
}

/** The row for a slug, if that slug is a headword page. */
export function lookupSlug(slug: string): SearchRow | undefined {
  return slugMap.get(slug);
}

/** The headword whose slug equals slugify(q), if any. */
export function exactHeadword(q: string): SearchRow | undefined {
  const slug = slugify(q);
  return slug ? slugMap.get(slug) : undefined;
}

/**
 * Ranked headword matches for a query. Requires ensureIndex() to have
 * resolved; returns [] otherwise.
 */
export function searchHeadwords(q: string): SearchRow[] {
  if (!mini || !q) return [];
  const hits = mini.search(q) as unknown as SearchRow[];
  // Promote an exact-headword match to position 1. BM25 deflates the IDF of
  // common terms ("word" appears as a token in dozens of compound headwords —
  // Word-blind, Word-catcher, …) so prefix matches against rarer terms like
  // "wordy" can outscore the literal "Word" entry. Bypass that by trusting
  // the slug.
  const exact = exactHeadword(q);
  if (exact) {
    const idx = hits.findIndex((r) => r.s === exact.s);
    if (idx > 0) {
      hits.splice(idx, 1);
      hits.unshift(exact);
    } else if (idx < 0) {
      hits.unshift(exact);
    }
  }
  return hits;
}

/** URL of the full results page for a query. */
export function searchPageUrl(q: string): string {
  return `/search/?q=${encodeURIComponent(q)}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
