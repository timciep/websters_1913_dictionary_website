// Full-string overrides: the entire author field must equal the key (after
// trimming a trailing period) for the expansion to apply.
const AUTHOR_EXPANSIONS: Record<string, string> = {
  Shak: 'Shakespeare',
};

// Prefix overrides: applied when the author field *starts* with `"{key}. "` or
// is exactly `"{key}."`. Used for Bible-book citations like "Ps. xxiii. 4".
const AUTHOR_PREFIX_EXPANSIONS: Record<string, string> = {
  Ps: 'Bible (KJV) - Psalm',
  Prov: 'Bible (KJV) - Proverb',
};

/** Clean up a raw `<qau>` author string for display. */
export function formatAuthor(author: string): string {
  const stripped = author.replace(/\.$/, '');
  if (AUTHOR_EXPANSIONS[stripped]) return AUTHOR_EXPANSIONS[stripped];

  for (const [abbr, full] of Object.entries(AUTHOR_PREFIX_EXPANSIONS)) {
    if (stripped === abbr) return full;
    if (stripped.startsWith(abbr + '. ')) {
      return full + ' ' + stripped.slice(abbr.length + 2);
    }
  }
  return stripped;
}
