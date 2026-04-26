# CLAUDE.md

Notes for AI assistants working in this repo. Read `README.md` first for the
human-facing overview; this file documents the things that aren't obvious from
the code and the constraints to keep in mind when making changes.

## What this project is

A static website that serves the public-domain *Webster's Revised Unabridged
Dictionary* (1913) — 124,186 headwords, one HTML page per word, plus a
client-side search box. Built with Astro 4 in static-output mode.

There are two halves and they should stay decoupled:

1. **Data pipeline** (`data-pipeline/`) — runs offline via `npm run data`,
   reads GCIDE source files, writes `data/entries/{a..z}/{slug}.json` and
   `public/search-index.json`. Pure Node, no Astro deps.
2. **Site** (`src/`) — Astro project. Reads the JSON output of the pipeline
   at build time via `loadAllEntries()` in `src/lib/entry.ts`.

The pipeline output is the **only interface** between the two halves. If you
change the entry shape, change `EntryRecord` in `data-pipeline/build-data.ts`
and `Entry` in `src/lib/entry.ts` together.

## Source data: GCIDE quirks

The pipeline parses [GCIDE](https://gcide.gnu.org.ua/) directly. GCIDE files
look like SGML but have two non-standard features that already trip up
naive parsers:

### 1. Self-closing entity tags with no `>`

Special characters are encoded as `<NAME/` — note: **no closing angle
bracket**. Examples from real entries:

```
(<adot/*b<amac/s")     →  (ȧ*bās")
<ent>1-dodecanol</ent> →  normal text
<frac12/                →  ½
<br/                    →  line break (also no >)
```

`data-pipeline/entities.ts` handles these:

- A small fixed table (`NAMED`) for named entities (`frac12`, `aelig`, Greek
  letters, currency symbols, …).
- For unknown `<{letter}{accent}/` patterns it splits the name as
  `{letter}` + `{combining-mark}` and emits `letter + combining-char`
  (`<adot/` → `'a' + '\u0307'` → `ȧ`). The `COMBINING` table maps accent
  names like `dot`, `mac`, `acute` to the right Unicode combining mark.
- Anything else with a letter prefix degrades to the bare letter; everything
  else is dropped.

If you find characters rendering as bare letters (e.g. "a" where "ā" was
expected), check whether the entity name needs to be added to `NAMED` or
whether the accent suffix is missing from `COMBINING`. Don't try to expand
`NAMED` to be exhaustive — the combining-mark fallback covers the long tail.

### 2. Headword grouping by paragraph runs

A single headword's content spans **multiple `<p>...</p>` blocks**:

```
<p><ent>Abase</ent> ... <pos>v. t.</pos> <ety>...</ety> <def>1st sense</def></p>
<p><sn>2.</sn> <def>2nd sense</def></p>
<p><q>quotation</q> <qau>author</qau></p>
<p><ent>Abased</ent> ... </p>   ← next entry starts here
```

`parseGcideFile` in `parse-gcide.ts` walks the `<p>` blocks and starts a new
`RawEntry` whenever it sees `<ent>`. Subsequent blocks (no `<ent>`) get
appended to the current entry as additional senses or quotations. Don't
"fix" this by trying to find entry boundaries some other way — the `<ent>`
sentinel is the only reliable signal.

## Slugs and homographs

`src/lib/slug.ts` is shared between the pipeline and the site — they MUST
agree on slug generation or cross-reference links will 404.

The slug rules (in order):

1. Expand ligatures explicitly: `æ → ae`, `œ → oe`, `ß → ss`, `þ → th`,
   `ð → d`. (NFKD doesn't decompose these, so we do it ourselves.)
2. NFKD-normalize and strip combining marks.
3. Lowercase, collapse non-`[a-z0-9]` to `-`, trim hyphens.

**Homographs share a page.** Every `RawEntry` whose headword slugifies to
the same value is collected into a single `EntryPageRecord` (see
`build-data.ts#addForm`) with a `forms[]` array — one entry per spelling /
part-of-speech variant. So `/word/slice/` renders the noun, the transitive
verb, and the golf sense all on one page; there is no `slice-2` or
`slice-3`. The order of `forms[]` is the order in which GCIDE declared
them, so it's still order-sensitive — but URLs are stable across
re-orderings (only the *content order on the page* changes, never the
addressable slug).

The on-disk shape lives in `data-pipeline/build-data.ts` (`EntryPageRecord`
+ `EntryFormRecord`) and is mirrored on the site side as `EntryPage` +
`EntryForm` in `src/lib/entry.ts`. Cross-references resolve against the
flat slug set returned by `loadSlugSet()` — there is no per-form
addressing, so a `<er>set</er>` always lands on `/word/set/` and the reader
chooses among the homograph forms there.

## Cross-references

Inside definitions, `<er>X</er>` marks a cross-reference to headword `X`.
The pipeline **preserves** these tags on disk (see `postProcessDef` —
everything else is stripped). At render time, `src/lib/crossref.ts` resolves
each `<er>` against the full slug set:

- Strip GCIDE homograph suffixes (`{2}`, `{3b}`, `[wn1]`, etc.) from the
  target text before slugifying — our site merges homographs onto one page,
  so these are noise.
- If `slugify(target)` is in `knownSlugs`, emit
  `<a class="xref" href="/word/{slug}/">target</a>`.
- If the slug is not found but appears in `SLUG_CORRECTIONS`, the corrected
  slug is used instead (see below). Corrected links get a small `∗` indicator
  with a tooltip showing the original text.
- Otherwise, emit `<i>target</i>` (italicized — no broken links).

The slug set is loaded once and passed into every page via `getStaticPaths`
in `src/pages/word/[slug].astro`. `loadAllEntries()` and `loadSlugSet()`
both cache after the first call, so this is cheap.

**`SLUG_CORRECTIONS`** — GCIDE contains ~60 misspelled or mis-hyphenated
cross-reference targets. Rather than patching the vendor data,
`crossref.ts` keeps a `SLUG_CORRECTIONS` map (`wrong-slug → right-slug`)
that redirects at render time. Three categories:

- **Typos** — `achorman` → `anchorman`, `hoookah` → `hookah`, etc.
- **Hyphenation mismatches** — `Gilly-flower` → `gillyflower`, `Toad flax`
  → `toadflax`, etc.
- **Alternate spellings** — `dextrotatory` → `dextrorotatory`, etc.

When you find a cross-ref that should link but doesn't, check whether the
`<er>` text has a typo or spacing mismatch — if so, add the correction
here rather than editing the GCIDE files. Always verify the target slug
exists in `data/entries/` before adding. ~545 broken cross-refs remain;
most are multi-word terms that don't exist as headwords and can't be fixed
without adding new content.

**Etymology cross-refs are NOT linkified** — `parseGcideFile` strips all
tags from `<ety>` content (this is the easiest known cleanup; if you fix
it, do it the same way `postProcessDef` does for definitions: keep `<er>`
tags in the etymology field and run `renderDefinition` on it at render
time).

## Abbreviation expansions

`src/lib/crossref.ts` replaces scholarly, language, and subject-area
abbreviations with their spelled-out form inline (e.g. `(Bot.)` →
`(botany)`, `Cf.` → `Compare`, `[OF. <i>foo</i>]` →
`[Old French <i>foo</i>]`). The headword's part-of-speech label is
expanded the same way in `src/components/Definition.astro` via
`expandPos()`. When the user says **"spell out X"** or **"expand X"**,
this is where it goes.

Three mechanisms, pick the right one:

1. **`ABBR_HINTS`** — a list of `[RegExp, expansion]` pairs. Matches
   anywhere in the escaped text. Use this for:
   - Scholarly shorthands (`Cf.`, `e.g.`, `i.e.`, `viz.`, `Fig.`, …)
   - Language abbreviations from etymology brackets (`OF.`, `Gr.`, `Skr.`,
     `OHG.`, …)
   - Longer patterns must come before their prefixes (regex is evaluated
     in order, and alternation inside a single regex isn't used here).

2. **`FIELD_ABBRS`** — a `Record<string, string>` mapping subject-area
   abbreviations to expansions (`Bot.` → `botany`, `Gram.` → `grammar`,
   `Zool.` → `zoology`, …). Compiled into one regex matched only inside
   parens via `(?<=\([^)]*)…(?=[^(]*\))`, so it catches `(Bot.)` and the
   second token in `(Bot. & Zool.)` while leaving identical strings in
   author initials, citation sources, or free prose alone (`Her.`,
   `Com. Prayer`, `Man. 11`). Add a new entry when GCIDE uses a field
   marker the table doesn't cover yet — only add ones that are
   unambiguous as field markers when seen inside parens.

3. **`INFLECTION_ABBRS`** — a list of strings compiled into one regex
   with a `(?= of )` lookahead. Use this for part-of-speech / inflection
   abbreviations like `imp.`, `p. p.`, `p. pr. & a.` that would collide
   with author initials or end-of-sentence periods in free prose. They
   only get expanded when followed by ` of ` (the canonical GCIDE
   "form-of" stub shape, e.g. `imp. of <er>Run</er>` →
   `imperfect of Run`). Longer patterns must come **before** their
   prefixes so alternation matches greedily (`imp. & p. p.` before
   `imp.`). Expansions come from `expandPos()` in `src/lib/pos.ts` — if
   a new inflection isn't covered there, add it.

**Capitalization rule:** `expandToText` capitalises the first letter of
the expansion when the original abbreviation starts with an uppercase
letter (`Cf.` → `Compare`, `cf.` → `compare`). Expansions that are
already proper nouns (e.g. `Old French`, `Scripture`) pass through
unchanged.

**Deliberately skipped:** single-letter language codes (`F.`, `L.`, `D.`,
`G.`, `W.`, `E.`, `Sp.`). They collide with author initials, `D.C.`,
`Sp. gr.` (specific gravity), Fahrenheit, and end-of-sentence captures.
Don't add these to `ABBR_HINTS` without a much cleverer matcher.

**Ordering constraint:** `expandAbbrs` runs on already-HTML-escaped
text and emits plain text (no markup). It must run *after* `escapeHtml`
and *only* on the non-`<er>` segments (the `<er>` inner text is rendered
as anchor/italic content and shouldn't be expanded). `renderDefinition`
already wires this up correctly.

The CSS class `pos-abbr` still exists in `global.css` because the
"added by GCIDE/WordNet" source-info badge in `Definition.astro` uses
it for a hover tooltip — that badge is meta information, not an
abbreviation expansion, so it stays as a tooltip.

## Build constraints

### The search index download budget

`public/search-index.json` is fetched by every visitor on first focus of the
search box. It currently weighs **5.1 MB** (~1.5 MB gzipped) for 124k
headwords with just `{slug, headword, partOfSpeech}` per row.

**Do not** add fields to `SearchRow` casually — every byte is multiplied by
124k. The earlier version included a 140-char short definition per row and
ballooned to 13 MB. If a feature needs definition text in autocomplete,
shard the index by first letter and load shards on demand instead of
fattening the master index.

### `getStaticPaths` is the bottleneck

`npm run build` renders **124,187 pages** in ~50 s. The slow step is
`getStaticPaths` reading every JSON file from disk. If you make this slower
(e.g. by doing per-page work that should be lifted into the loader),
build time will balloon.

If you need to add another statically-generated page type (e.g. browse-by-
letter index pages), do it as separate `src/pages/letter/[letter].astro`
routes, not by inflating the word route's params.

### What's gitignored on purpose

- `data/` — generated by `npm run data`. ~500 MB. Never commit.
- `public/search-index.json` — also generated. Never commit.
- `dist/` — Astro build output. ~491 MB.
- `data-pipeline/vendor/gnu_gcide/` — cloned at setup time. Don't commit
  the GCIDE corpus into this repo.

A fresh checkout requires three commands: `npm install`,
`git clone … gnu_gcide`, then `npm run data`. After that the site builds.

## Dark mode

The site supports light/dark themes via CSS custom properties on `:root`
and a `[data-theme="dark"]` override block in `global.css`. The mechanism:

- An inline `<script>` in `<head>` (in `Base.astro`) reads
  `localStorage('theme')` and sets `data-theme="dark"` on `<html>` before
  paint, so there is no flash of wrong theme.
- A sun/moon toggle button in the site header flips the attribute and
  persists the choice to `localStorage`. Defaults to light if nothing is
  stored.
- All colors flow through CSS variables (`--bg`, `--ink`, `--rule`,
  `--accent`, `--link`, `--link-hover`). Any new UI that uses these
  variables will automatically respect dark mode — avoid hardcoding color
  values.

## Common tasks and where to do them

| Task | Where |
|---|---|
| Add a new field to entry JSON | `data-pipeline/build-data.ts` (`EntryFormRecord`/`EntryPageRecord`, `addForm`) + `src/lib/entry.ts` (`EntryForm`/`EntryPage`) — keep them in sync |
| Add a new GCIDE tag to extract | `data-pipeline/parse-gcide.ts` — add to `firstTag`/`allTags` calls in `parseGcideFile`/`pushSenseFromBlock` |
| Add a missing special character | `data-pipeline/entities.ts` — `NAMED` table, or add a missing accent to `COMBINING` |
| Spell out an abbreviation inline | `src/lib/crossref.ts` — `ABBR_HINTS` for scholarly/language abbrevs, `FIELD_ABBRS` for parenthetical subject-area markers like `(Bot.)`, `INFLECTION_ABBRS` (+ `src/lib/pos.ts`) for `imp.`/`p. p.`-style form-of stubs. See "Abbreviation expansions" section |
| Fix a misspelled cross-reference | `src/lib/crossref.ts` — add to `SLUG_CORRECTIONS`. See "Cross-references" section |
| Change slug rules | `src/lib/slug.ts` — **regenerate `data/` after** (`npm run data`) and rebuild the site, or all cross-references break |
| Add a new page type | New file in `src/pages/`. Don't tangle it with `word/[slug].astro` |
| Tweak typography | `src/styles/global.css` — single hand-written stylesheet, no CSS framework |
| Adjust dark-mode colors | `src/styles/global.css` — `[data-theme="dark"]` block. See "Dark mode" section |
| Change search behavior | `src/components/SearchBox.astro` — vanilla TS in an Astro `<script>`, MiniSearch options live in the `new MiniSearch({...})` call |

## Things to avoid

- **Don't pull in WebsterParser as a dependency.** It exists (and is
  referenced in the original plan as inspiration) but it's tied to Apple's
  Dictionary Kit toolchain. Parsing GCIDE directly is simpler and we already
  do it well. The `vendor/` directory should hold *only* `gnu_gcide`.
- **Don't add a CSS framework.** The site is intentionally a single
  ~150-line stylesheet. The whole aesthetic is "looks like a book."
- **Don't add server-side rendering or a backend.** This is a static site by
  design — `output: 'static'` in `astro.config.mjs` is load-bearing for
  hosting cost and simplicity.
- **Don't commit `data/`, `dist/`, `public/search-index.json`, or
  `data-pipeline/vendor/`.** All four are gitignored.
- **Don't change `slug.ts` without regenerating `data/`.** The pipeline
  bakes slugs into filenames; stale data will produce broken cross-refs and
  404s on the next build.

## Verification checklist

After non-trivial changes, verify end-to-end:

```bash
npm run data    # if you touched the pipeline or slug.ts
npm run build   # full site build
npm run preview # http://localhost:4321
```

Spot-check pages:

- `/word/abase/` — multi-sense entry with quotations + author attribution
- `/word/aard-wolf/` — contains a `<er>Proteles</er>` cross-ref that should
  resolve to `/word/proteles/`
- `/word/set/` and `/word/slice/` — multi-form pages collecting noun + verb homographs
- `/` — type "ser" in the search box, expect autocomplete results within a
  few hundred ms after the index loads

If any of those break, the pipeline and the site are out of sync — usually
because `data/` is stale relative to `slug.ts` or the entry shape.
