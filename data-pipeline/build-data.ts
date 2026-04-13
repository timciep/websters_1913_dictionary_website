// Orchestrates the data build:
//   1. Reads every CIDE.{A..Z} file from the vendored gnu_gcide submodule.
//   2. Parses each into RawEntry[] via parse-gcide.ts.
//   3. Slugifies headwords (with homograph disambiguation).
//   4. Writes one JSON file per headword to data/entries/{letter}/{slug}.json.
//   5. Writes a single data/search-index.json containing the slim search rows.
//
// Run with: npm run data
//
// Idempotent: re-running overwrites prior output. We do NOT delete the data/
// directory first — if you need a fresh build, `rm -rf data/` manually.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGcideFile, type RawEntry } from './parse-gcide.js';
import { slugify } from '../src/lib/slug.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const GCIDE_DIR = path.join(ROOT, 'data-pipeline/vendor/gnu_gcide');
const OUT_DIR = path.join(ROOT, 'data');
const ENTRIES_DIR = path.join(OUT_DIR, 'entries');

// The shape we serialize to disk. Each page collects every homograph that
// shares a base slug — `slice` (n.), `slice` (v. t.), `slice` (v. t. Golf)
// all live on /word/slice/ as separate "forms" of the same page.
export interface EntryFormRecord {
  headword: string;
  variants: string[]; // additional headword spellings from <ent>
  pronunciation?: string;
  partOfSpeech?: string;
  etymology?: string;
  senses: {
    number?: string;
    definition: string;
    quotations: { text: string; author?: string }[];
    source?: string;
  }[];
}

export interface EntryPageRecord {
  slug: string;
  headword: string; // display headword (from the first form)
  forms: EntryFormRecord[];
}

export interface SearchRow {
  s: string; // slug
  h: string; // headword (display form)
  p?: string; // part(s) of speech, joined by '; ' if multiple homographs
}

async function main() {
  console.log(`[build-data] gcide source: ${GCIDE_DIR}`);
  // Wipe stale per-entry JSON so renamed/removed slugs don't linger between
  // runs. (Cheap relative to the total build, and required after we collapsed
  // homographs onto a single page — old `slice-2.json` files would otherwise
  // remain and confuse the loader.)
  await fs.rm(ENTRIES_DIR, { recursive: true, force: true });
  await ensureDir(ENTRIES_DIR);

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  // Group by base slug, preserving insertion order so the first homograph in
  // the GCIDE source remains the first form on the page.
  const pages = new Map<string, EntryPageRecord>();
  let formCount = 0;

  for (const letter of letters) {
    const file = path.join(GCIDE_DIR, `CIDE.${letter}`);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (err) {
      console.warn(`[build-data] missing ${file} — skipping (${(err as Error).message})`);
      continue;
    }
    console.log(`[build-data] parsing CIDE.${letter} (${(raw.length / 1024 / 1024).toFixed(1)} MB)`);
    const entries = parseGcideFile(raw);
    console.log(`[build-data]   → ${entries.length} entries`);

    for (const e of entries) {
      const grouped = addForm(e, pages);
      if (grouped) formCount++;
    }
  }

  console.log(`[build-data] total forms: ${formCount} across ${pages.size} pages`);
  console.log(`[build-data] writing per-page JSON …`);

  // Write per-page files (sharded by first letter of slug)
  let written = 0;
  for (const rec of pages.values()) {
    const shard = rec.slug[0]?.match(/[a-z]/) ? rec.slug[0] : '_';
    const dir = path.join(ENTRIES_DIR, shard);
    await ensureDir(dir);
    await fs.writeFile(path.join(dir, `${rec.slug}.json`), JSON.stringify(rec));
    written++;
    if (written % 10_000 === 0) console.log(`[build-data]   wrote ${written} files`);
  }

  // Write search index — keep this lean: it's downloaded by every visitor.
  // One row per page, joining the parts of speech of all homographs.
  const index: SearchRow[] = [];
  for (const rec of pages.values()) {
    const pos = uniq(rec.forms.map((f) => f.partOfSpeech).filter(Boolean) as string[]).join('; ');
    index.push({ s: rec.slug, h: rec.headword, p: pos || undefined });
  }
  await fs.writeFile(path.join(OUT_DIR, 'search-index.json'), JSON.stringify(index));
  // Also publish to public/ so Astro serves it as a static asset.
  const publicDir = path.join(ROOT, 'public');
  await ensureDir(publicDir);
  await fs.writeFile(path.join(publicDir, 'search-index.json'), JSON.stringify(index));
  console.log(`[build-data] wrote search-index.json (${index.length} rows)`);
  console.log(`[build-data] done.`);
}

function addForm(e: RawEntry, pages: Map<string, EntryPageRecord>): EntryFormRecord | null {
  const headword = stripStress(e.displayHeadword) || e.headwords[0];
  if (!headword) return null;
  const slug = slugify(headword);
  if (!slug) return null;

  const form: EntryFormRecord = {
    headword,
    variants: e.headwords.filter((h) => h !== headword),
    pronunciation: e.pronunciation,
    partOfSpeech: e.partOfSpeech,
    etymology: e.etymology,
    senses: e.senses,
  };

  const existing = pages.get(slug);
  if (existing) {
    existing.forms.push(form);
  } else {
    pages.set(slug, { slug, headword, forms: [form] });
  }
  return form;
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function stripStress(hw: string): string {
  // <hw> uses `*` for syllable break and `"` for stress; strip them for display.
  return hw.replace(/[*"`]/g, '').trim();
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
