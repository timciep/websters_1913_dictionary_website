/**
 * Convert a Webster's headword into a URL slug.
 *
 * Rules:
 *   - NFKD-normalize, strip combining marks (so "Ælþēr" → "AElþer" → ...)
 *   - Lowercase
 *   - Replace any run of non-[a-z0-9] with a single hyphen
 *   - Trim leading/trailing hyphens
 *
 * Homograph collisions (e.g. multiple "set" entries) are disambiguated by the
 * caller appending `-1`, `-2`, ... in entry order.
 */
export function slugify(headword: string): string {
  // Common ligature expansion before NFKD (which doesn't decompose æ/œ)
  const expanded = headword
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'Ae')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'Oe')
    .replace(/ß/g, 'ss')
    .replace(/þ/gi, 'th')
    .replace(/ð/gi, 'd');

  return expanded
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
