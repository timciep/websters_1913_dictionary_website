# Webster's 1913

A static website serving the complete text of *Webster's Revised Unabridged
Dictionary* (1913) — 124,186 headwords, browsable as one HTML page per word,
with client-side autocomplete search and cross-reference links between
entries.

The dictionary text is in the public domain and comes from the
[GNU Collaborative International Dictionary of English (GCIDE)][gcide], which
in turn descends from the 1913 edition originally digitized by Project
Gutenberg.

[gcide]: https://gcide.gnu.org.ua/

## Features

- **One page per headword, zero JavaScript.** Every entry is pre-rendered to
  its own static HTML page at build time. Reading a definition ships no JS,
  no tracking, no web fonts — just the text of the dictionary.
- **Client-side autocomplete search.** A MiniSearch index over all 124k
  headwords is fetched lazily on first focus of the search box, giving
  prefix-matching autocomplete with a small fuzzy tolerance and no server.
- **Linkified cross-references.** `<er>...</er>` tags inside definitions are
  resolved against the full slug set at render time. If the target exists
  the word becomes a link to its entry page; if it doesn't, it falls back
  to italics rather than a broken link. So on `/word/aard-wolf/` the
  mention of *Proteles* is a live link to `/word/proteles/`.
- **Tooltips on scholarly abbreviations.** Shorthands like *Cf.*, *e.g.*,
  *i.e.*, *viz.*, and language codes from etymology brackets (*OF.*, *Gr.*,
  *Skr.*, *OHG.*, …) are wrapped in `<abbr>` elements so hovering or
  focusing them reveals the expansion. Part-of-speech / inflection stubs
  like *imp. of run* or *p. p. of write* get the same treatment.
- **Homographs collected on one page.** Every spelling or part-of-speech
  variant that slugifies to the same value is grouped onto a single entry
  page — `/word/set/` lists the noun, the transitive verb, the intransitive
  verb, and the adjective together, in the order GCIDE declared them.
  URLs stay stable no matter how many senses get added later.
- **Unicode-correct headwords and slugs.** Ligatures (`æ`, `œ`, `ß`, `þ`,
  `ð`) are explicitly expanded before NFKD normalization, so *ænigma* and
  *aenigma* resolve to the same page and the slug is always pure ASCII.
- **Book-like typography.** A single hand-written ~150-line stylesheet, no
  CSS framework, no tracking, no cookies.

## How it works

There are two halves to the project: a one-shot **data pipeline** that turns
the GCIDE source files into JSON, and an **Astro static site** that
pre-renders one page per headword at build time.

```
data-pipeline/
├── vendor/gnu_gcide/    # cloned upstream — 26 CIDE.{A..Z} files
├── entities.ts          # GCIDE special-character expander (<adot/ → ȧ, etc.)
├── parse-gcide.ts       # <p>-block + tag parser → RawEntry[]
└── build-data.ts        # orchestrator: parses every CIDE file, writes JSON

data/                    # generated, gitignored
├── entries/{a..z}/{slug}.json
└── search-index.json

src/
├── lib/
│   ├── slug.ts          # headword → URL slug (NFKD + ligature expansion)
│   ├── entry.ts         # types + on-disk loader
│   └── crossref.ts      # <er>...</er> → <a href="/word/{slug}/">
├── layouts/Base.astro
├── components/
│   ├── Definition.astro # renders one Entry
│   └── SearchBox.astro  # client island, MiniSearch autocomplete
└── pages/
    ├── index.astro      # landing + search
    └── word/[slug].astro # getStaticPaths over every entry
```

### Pipeline details

GCIDE files use an SGML-ish format with two quirks:

1. **Self-closing entity tags** like `<adot/`, `<amac/`, `<frac12/` (note the
   missing `>`) encode special characters. `entities.ts` resolves them — first
   against a fixed table for named entities, then by treating
   `<{letter}{accent}/` as the letter plus a Unicode combining mark
   (`<adot/` → `a` + `\u0307` → `ȧ`).
2. **Headword grouping**: a `<p>` block containing `<ent>HEADWORD</ent>` starts
   a new entry; subsequent `<p>` blocks (additional senses, quotations) belong
   to the previous entry until the next `<ent>` is seen.

The parser extracts: headword, pronunciation (`<pr>`), part of speech
(`<pos>`), etymology (`<ety>`), and a list of senses (`<sn>`/`<def>`) each with
their quotations (`<q>`/`<qau>`). Cross-reference tags `<er>...</er>` inside
definitions are preserved on disk and linkified at render time so the link
target can be checked against the full slug set.

Homographs (multiple entries for the same headword, e.g. the several different
`set`s) are **collected onto a single page**. Every `RawEntry` whose headword
slugifies to the same value is appended to one `EntryPageRecord` as an
additional `forms[]` entry, in the order GCIDE declared them. So `/word/set/`
renders the noun, the transitive verb, the intransitive verb, and the
adjective on one page — there is no `/word/set-2/`. URLs stay stable as new
senses get added; only the on-page order changes.

### Site details

- **Astro 4** in static-output mode. `src/pages/word/[slug].astro` exports a
  `getStaticPaths()` that returns every entry, so `npm run build` writes one
  `dist/word/{slug}/index.html` per headword.
- **No JS on entry pages.** The only client-side script is the search island.
- **Search** uses [MiniSearch](https://github.com/lucaong/minisearch) with
  prefix matching and a small fuzzy tolerance. The index (`search-index.json`,
  ~5 MB / ~1.5 MB gzipped) is fetched lazily on first input focus.
- **Cross-references** inside definitions are linkified at render time:
  `crossref.ts` looks each target up in the slug set and emits an `<a>` only if
  the page exists, otherwise an italicized span.

## Usage

```bash
# 1. install
npm install

# 2. fetch the GCIDE source (one-time)
git clone --depth=1 https://github.com/jeffbyrnes/gnu_gcide.git \
  data-pipeline/vendor/gnu_gcide

# 3. parse GCIDE → JSON (rerun whenever you upgrade GCIDE)
npm run data

# 4. dev server
npm run dev          # http://localhost:4321

# 5. production build (~50s, ~491 MB output)
npm run build
npm run preview
```

`npm run data` is the slow step (a few seconds) and `npm run build` is the
slowest (~50 s on a modern Mac to render 124k pages). Both are fully offline
once the GCIDE clone is in place.

## Hosting

Production is deployed to **GitHub Pages** via the GitHub Actions workflow in
`.github/workflows/`. The custom domain is configured through `public/CNAME`.
Because the site is fully static (`output: 'static'` in `astro.config.mjs`),
the deploy is just an upload of `dist/` — no server, no backend.

## Known limitations

- **"Serendipity" is not in the dictionary.** It's not a parser bug — the word
  was rare in 1913 and GCIDE doesn't carry it.
- **Cross-references inside `<ety>` (etymology) blocks are not linkified.** The
  parser currently strips all tags from etymology text. Easy to extend by
  giving etymology the same treatment as definitions.
- **The search index is ~5 MB** because it's a flat JSON list of every
  headword. For lower bandwidth, consider switching to a serialized
  pre-built MiniSearch index, or sharding by first letter.
- **No full-text search across definition bodies** — only headwords and parts
  of speech are indexed.

## License & attribution

The dictionary text is public domain via GCIDE; see
`data-pipeline/vendor/gnu_gcide/COPYING` once the submodule is cloned. The
parser, build pipeline, and site code in this repository are original work.
