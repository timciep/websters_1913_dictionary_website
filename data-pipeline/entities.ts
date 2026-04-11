// Mapping for GCIDE self-closing character entity tags like `<adot/`, `<amac/`,
// `<frac12/`, `<aelig/`, etc. The format is `<NAME/` (note the missing `>`).
//
// GCIDE encodes a huge number of accented and special characters this way.
// We cover the common ones explicitly; for unknown `<{letter}{accent}/` patterns
// we fall back to combining characters; for everything else we drop the tag and
// keep the bare letter (or an empty string for non-letter entities).

// Combining diacritical marks (applied AFTER the base letter)
const COMBINING: Record<string, string> = {
  acute: '\u0301', // á
  grave: '\u0300', // à
  cir: '\u0302', // â  (circumflex)
  til: '\u0303', // ã  (tilde)
  mac: '\u0304', // ā  (macron)
  breve: '\u0306', // ă
  dot: '\u0307', // ȧ
  uml: '\u0308', // ä  (diaeresis / umlaut)
  ring: '\u030A', // å
  hac: '\u030C', // ǎ  (haček / caron)
  cedil: '\u0327', // ç
  sec: '\u0301', // secondary acute (treat like acute)
};

// Standalone named entities → literal Unicode
const NAMED: Record<string, string> = {
  // Ligatures
  aelig: 'æ',
  AElig: 'Æ',
  oelig: 'œ',
  OElig: 'Œ',
  szlig: 'ß',
  // Eth / thorn
  eth: 'ð',
  ETH: 'Ð',
  thorn: 'þ',
  THORN: 'Þ',
  // Punctuation / dashes
  mdash: '—',
  ndash: '–',
  hyph: '-',
  rdquo: '”',
  ldquo: '“',
  lsquo: '‘',
  rsquo: '’',
  prime: '′',
  Prime: '″',
  bullet: '•',
  middot: '·',
  dagger: '†',
  Dagger: '‡',
  para: '¶',
  sect: '§',
  // Math / misc
  times: '×',
  divide: '÷',
  plusmn: '±',
  deg: '°',
  micro: 'µ',
  infin: '∞',
  asymp: '≈',
  ne: '≠',
  le: '≤',
  ge: '≥',
  sum: '∑',
  prod: '∏',
  surd: '√',
  // Currency
  pound: '£',
  euro: '€',
  cent: '¢',
  yen: '¥',
  // Fractions
  frac12: '½',
  frac13: '⅓',
  frac14: '¼',
  frac15: '⅕',
  frac16: '⅙',
  frac18: '⅛',
  frac23: '⅔',
  frac25: '⅖',
  frac34: '¾',
  frac35: '⅗',
  frac38: '⅜',
  frac45: '⅘',
  frac56: '⅚',
  frac58: '⅝',
  frac78: '⅞',
  // Greek (the most common ones in etymologies)
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Alpha: 'Α',
  Beta: 'Β',
  Gamma: 'Γ',
  Delta: 'Δ',
  Epsilon: 'Ε',
  Zeta: 'Ζ',
  Eta: 'Η',
  Theta: 'Θ',
  Iota: 'Ι',
  Kappa: 'Κ',
  Lambda: 'Λ',
  Mu: 'Μ',
  Nu: 'Ν',
  Xi: 'Ξ',
  Omicron: 'Ο',
  Pi: 'Π',
  Rho: 'Ρ',
  Sigma: 'Σ',
  Tau: 'Τ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Chi: 'Χ',
  Psi: 'Ψ',
  Omega: 'Ω',
  // Music
  sharp: '♯',
  flat: '♭',
  natural: '♮',
};

// Letters that may be combined with diacritics (uppercase + lowercase a–z)
const VOWEL_LETTERS = 'aeiouyAEIOUY'.split('');
const ALL_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Try to interpret a tag name as `{letter}{combining-mark-name}` and return
 * the combined character. Returns `null` if no such interpretation works.
 */
function tryCombining(name: string): string | null {
  // Check letter prefixes from longest to shortest is unnecessary —
  // letters are 1 char so we can just match the first character.
  if (name.length < 2) return null;
  const first = name[0];
  const rest = name.slice(1);
  if (!ALL_LETTERS.includes(first)) return null;
  const mark = COMBINING[rest];
  if (!mark) return null;
  // Only apply diacritics to vowels + a few consonants commonly accented (c, n, s, z).
  if (!VOWEL_LETTERS.includes(first) && !'cCnNsSzZgG'.includes(first)) {
    // Still allow it — diacritics can appear on any letter in foreign words.
  }
  return (first + mark).normalize('NFC');
}

/**
 * Replace a single GCIDE entity name with its UTF-8 equivalent.
 * Returns the replacement string (possibly empty if we choose to drop it).
 */
export function resolveEntity(name: string): string {
  if (name in NAMED) return NAMED[name];
  const combined = tryCombining(name);
  if (combined) return combined;
  // Unknown — preserve the bare first letter if it looks like `{letter}{accent}`,
  // otherwise drop entirely.
  if (name.length >= 2 && ALL_LETTERS.includes(name[0])) return name[0];
  return '';
}

/**
 * Replace all `<NAME/` self-closing entity tags in `text`.
 */
export function expandEntities(text: string): string {
  // Match <name/ where name is letters/digits and the / is NOT followed by `>`
  // (those are normal self-closing XML tags). GCIDE's malformed form ends in `/`.
  return text.replace(/<([A-Za-z][A-Za-z0-9]*)\/(?!>)/g, (_m, name: string) => {
    return resolveEntity(name);
  });
}
