/**
 * Recover the pre-join `sections: string[]` array from a stored
 * beat-writer `llm_calls.user_prompt`.
 *
 * `src/agents/writer/beat-context.ts:227` joins sections with `\n\n`,
 * and in non-compact mode the CHARACTERS section at
 * `beat-context.ts:195-199` contains internal `\n\n` delimiters via
 * `snapshots.join("\n\n")`. A naive `userPrompt.split("\n\n")` cannot
 * recover the original `sections[]`.
 *
 * Algorithm: split on `\n\n`, then merge adjacent splits back into a
 * single section whenever the second split does NOT start with one of
 * the recognized section-header prefixes.
 *
 * Dry-run yield on `novel-1776690960321`: 314/314 beats (100%), with
 * 1205 merge-back operations across those 314 beats (up to 17 merges
 * per beat). Verified in `docs/charters/arm-b-detector-preflight-dryrun-results.md`.
 */

/**
 * Closed set of section-header prefixes emitted by `beat-context.ts`
 * (plus `reference-resolver.ts:150` for the BACKGROUND block). Any
 * `\n\n`-split chunk whose leading bytes match one of these starts a
 * fresh section; otherwise the chunk is merged into the previous
 * section with the `\n\n` delimiter restored.
 *
 * The beat-spec section at index 0 has no header — everything before
 * the first recognized header is treated as the beat-spec.
 */
export const SECTION_HEADER_PREFIXES = [
  "TRANSITION BRIDGE",
  "LANDING TARGET",
  "CHARACTERS:",
  "BACKGROUND:",
  "SETTING:",
  "Sensory:",
  // Arm B preflight only — the section the preflight inserts:
  "ENRICHED CONTEXT:",
] as const

export function startsWithSectionHeader(s: string): boolean {
  for (const prefix of SECTION_HEADER_PREFIXES) {
    if (s.startsWith(prefix)) return true
  }
  return false
}

/**
 * Recover the original `sections: string[]` array from the joined
 * user_prompt bytes.
 */
export function recoverSections(userPrompt: string): string[] {
  const raw = userPrompt.split("\n\n")
  const merged: string[] = []
  for (const chunk of raw) {
    if (merged.length === 0 || startsWithSectionHeader(chunk)) {
      merged.push(chunk)
    } else {
      merged[merged.length - 1] += "\n\n" + chunk
    }
  }
  return merged
}

/**
 * Return the header-identity label for a section (for diagnostics).
 * `"(beat-spec)"` for the unheaded leading section; the matching
 * header prefix (colon stripped) for the rest.
 */
export function sectionHeader(section: string): string {
  for (const prefix of SECTION_HEADER_PREFIXES) {
    if (section.startsWith(prefix)) return prefix.replace(":", "")
  }
  return "(beat-spec)"
}

/**
 * Per-section integrity signature for the offline archival baseline
 * per charter §6 step 4b. Lightweight — detects drift between dry-run
 * and runtime when the full section strings are also stored.
 */
export interface SectionSignature {
  header: string // from sectionHeader()
  byteLength: number
  sha256: string
}

/**
 * Compute the signature for a sections[] array. Uses Bun's built-in
 * CryptoHasher for SHA-256.
 */
export function computeSignature(sections: string[]): SectionSignature[] {
  return sections.map(s => ({
    header: sectionHeader(s),
    byteLength: Buffer.byteLength(s, "utf8"),
    sha256: Bun.CryptoHasher.hash("sha256", s, "hex") as string,
  }))
}
