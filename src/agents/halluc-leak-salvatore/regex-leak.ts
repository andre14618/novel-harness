/**
 * Deterministic regex-based leak detector. OR-combined with the
 * `halluc-leak-salvatore-v1` adapter at inference time per Rung 0 of
 * `docs/scoping/halluc-leak-salvatore-v2.md`.
 *
 * Rung 0 measurement (2026-04-20, exp #254-derived production data):
 *   Adapter alone         : 158 beats flagged across 32 novels
 *   Regex alone           : 208 candidate beats
 *   OR-combine            : 208 beats — +50 vs adapter-only (+31.6%)
 *   Top adapter misses    : Harpells (35), Baldur's Gate (32), Waterdeep (15)
 *   Regex-only catches    : estimated ≥95% precision (all canonical FR corpus)
 *   Adapter-only residual : 12 beats (regex FNs — "dark elf" generic,
 *                           "Rumblebelly's" possessive, "mithril" lowercase)
 *
 * Verdict per `docs/scoping/halluc-leak-salvatore-v2.md` §5: regex
 * ceiling clears the ≥85% precision / ≥75% recall gate, so OR-combine
 * at inference is the correct intervention. No SFT spend required.
 *
 * Regex widen (2026-04-23): three residual FN classes closed:
 *   1. Possessive-suffix tolerance — `buildRegex` now appends an optional
 *      `(?:'s?|s')` group after each token, so "Rumblebelly's" and
 *      "Harpells'" both match. The lookahead checks the char AFTER the
 *      optional suffix so word-boundary semantics are preserved.
 *   2. "dark elf" variants — added "dark elf", "dark elves", "drow elf",
 *      "drow elves". Generic-sounding but Salvatore-corpus-signature per
 *      the Rung 0 adapter-only sample.
 *   3. Standalone "mithril" — added as a token. The regex is already
 *      case-insensitive (`gi`), so "Mithril Hall" was matching the two-word
 *      form but standalone "mithril" (lowercase) was not in the list.
 *
 * Token list: union of
 *   - `scripts/hallucination/expand-leak-vocab.ts` LEAK_TOKENS
 *   - scoping doc §B additions (production-confirmed gaps)
 *   - 2026-04-23 widen additions (possessive-suffix + dark-elf variants
 *     + standalone mithril)
 *
 * Keep this list in sync with `scripts/hallucination/rung-0-regex-ceiling.ts`
 * — any production gap we discover should land in both places.
 */

const LEAK_TOKENS = [
  // Characters (IWD trilogy)
  "Drizzt", "Bruenor", "Wulfgar", "Regis", "Catti-brie", "Rumblebelly",
  "Akar Kessell", "Entreri", "Jarlaxle", "Zaknafein", "Guenhwyvar",
  "Dendybar", "Pasha Pook", "Deudermont", "Cassius", "Heafstaag",
  "Biggrin", "Alustriel", "Do'Urden",
  // Places (IWD)
  "Mithril Hall", "Mithral Hall", "Icewind Dale", "Ten-Towns",
  "Bryn Shander", "Termalaine", "Easthaven", "Luskan", "Silverymoon",
  "Calimport", "Maer Dualdon", "Kelvin's Cairn", "Cryshal-Tirith",
  "Faerûn", "Sword Coast", "Forgotten Realms", "Lonelywood", "Targos",
  "Spine of the World",
  // Places (wider FR — scoping-doc additions, production-confirmed)
  "Waterdeep", "Baldur's Gate", "Chionthar", "Neverwinter",
  "Menzoberranzan", "Gauntlgrym", "Helm's Hold", "Sea of Swords",
  "Sea Sprite",
  // Items
  "Crystal Shard", "Crenshinibon", "Aegis-fang", "Twinkle", "Icingdeath",
  "Taulmaril",
  // Races / creatures — longer alternations before shorter so the regex
  // engine prefers "drow elf"/"dark elves" over the bare "drow"/"dark" prefix
  "dark elves", "dark elf", "drow elves", "drow elf", "drow",
  "duergar", "verbeeg",
  // Standalone corpus-vocabulary terms (case-insensitive via `gi` flag)
  "mithril",
  // exp-#254 additions
  "Drossen Ironbelly", "Harpells", "Nine-Towns",
]

function buildRegex(tokens: string[]): RegExp {
  const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  // Word-boundary assertions that allow apostrophes and hyphens inside tokens
  // but don't match substring contexts (e.g. "drow" must not match "drowsy").
  //
  // The optional `(?:'s?|s')` suffix handles possessive forms:
  //   "Rumblebelly's" — token + 's
  //   "Harpells'"     — token ending in s + '  (plural possessive)
  // The lookahead checks the character AFTER the optional suffix so word
  // boundaries are preserved for non-possessive contexts too.
  return new RegExp(
    `(?<=^|[^\\w'-])(?:${escaped.join("|")})(?:'s?|s')?(?=[^\\w'-]|$)`,
    "gi"
  )
}

const LEAK_REGEX = buildRegex(LEAK_TOKENS)

/**
 * Run the regex against the prose and return the deduped list of
 * matched corpus tokens. Preserves first-appearance casing.
 */
export function regexLeakMatches(prose: string): string[] {
  if (!prose) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of prose.matchAll(LEAK_REGEX)) {
    const raw = m[0]
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

// Exported for unit tests.
export { LEAK_TOKENS }
