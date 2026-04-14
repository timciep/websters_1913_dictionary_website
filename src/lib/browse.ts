import { loadAllEntries } from './entry';

export interface BrowseEntry {
  slug: string;
  headword: string;
  partOfSpeech?: string;
}

export interface LetterGroup {
  letter: string; // 'a'..'z' or '_'
  label: string; // 'A'..'Z' or '#'
  count: number;
  entries: BrowseEntry[];
}

let cached: LetterGroup[] | null = null;

export async function loadBrowseIndex(): Promise<LetterGroup[]> {
  if (cached) return cached;

  const pages = await loadAllEntries();
  const map = new Map<string, BrowseEntry[]>();

  for (const page of pages) {
    const first = page.slug[0];
    const key = /^[a-z]$/.test(first) ? first : '_';
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    bucket.push({
      slug: page.slug,
      headword: page.headword,
      partOfSpeech: page.forms[0]?.partOfSpeech,
    });
  }

  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const groups: LetterGroup[] = [];

  for (const letter of letters) {
    const entries = map.get(letter) ?? [];
    entries.sort((a, b) =>
      a.headword.localeCompare(b.headword, 'en', { sensitivity: 'base' }),
    );
    groups.push({
      letter,
      label: letter.toUpperCase(),
      count: entries.length,
      entries,
    });
  }

  const misc = map.get('_') ?? [];
  if (misc.length > 0) {
    misc.sort((a, b) =>
      a.headword.localeCompare(b.headword, 'en', { sensitivity: 'base' }),
    );
    groups.push({ letter: '_', label: '#', count: misc.length, entries: misc });
  }

  cached = groups;
  return groups;
}
