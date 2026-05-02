---
loop: L23a
status: shipped
created: 2026-05-02
experiment: 342
parent_experiments: [330, 340]
---

# L23a — NER Initials + Capitalized-First-Only Extractor Classes

## Summary

L22 (exp #340) found chapter 1 plan-assist fired on 4 NEW unresolved entities outside L20's fix class. Two of those were deterministic NER blind spots. L23a adds two new extractor classes to `src/lint/entity-candidates.ts` that close these patterns without lifting the FP rate on any calibration panel.

## Extractor Classes Shipped

### 1. `initials` class

**Regex:** `\b[A-Z]\.[A-Z]\.(?:[A-Z]\.)?(?=[\s,;:!?]|$)`

Matches abbreviated initials: `T.C.`, `J.R.R.`, `K.J.`, `R.A.S.`. Two or three initials only (minimum). Requires a word-boundary lookahead after the last period (prevents matching `T.C.s` mid-word). Sentence-initial filter omitted — initials are high-signal regardless of position.

**Example match:** `T.C.` in `"her own initials stamped in gold leaf: T.C., Examiner"`
**Example non-match:** `"e.g."` (lowercase), `"A."` (single initial)

**FP suppression:** `buildNerGroundedSet` now calls `deriveInitials(name)` for every entry in `characterRoster` + `beatCharacters` + `povCharacter`, and adds all derived initials to `surface.lower`. The `isNerGrounded` tier-1 check then suppresses grounded initials.

**`deriveInitials` helper:** Given `"Taryn Coombs Vey"`, produces `["T.C.V.", "T.C.", "C.V.", "T.V."]`. Given `"Taryn Coombs"`, produces `["T.C."]`. Exported from `entity-candidates.ts`.

### 2. `capitalized-first-only` class

**Regex:** `\b[A-Z][a-z]{3,}\s+[a-z]{4,}\b`

Matches two-word domain terms where the first word is capitalized (≥4 chars total) and the second word is entirely lowercase (≥4 chars). This targets compounds like `"Aether waste"`, `"Crystal lattice"`, `"Soul fire"` where the magic-system first word is capitalized but the following noun is not.

**Example match:** `"Aether waste"` in `"Every village the Aether waste takes"`
**Example non-match:** `"The boots"` (first word only 3 chars), `"Aether before"` (stop-word gate)

**Three-layer FP suppression (applied in `runNerPrepass`, NOT in extractor):**

1. **First-word bible-token gate:** "Aether" must be the first word of a `worldBible.systems`/`.locations`/`.cultures` entry. Character names ("Kael") are excluded — they're not the source of domain-term compounds. If no `bibleTokens` provided → suppress all cap-first-only candidates (safe fallback).

2. **Stop-word second-word gate:** Second word must not be a common function word (prepositions, conjunctions, auxiliaries: "before", "after", "with", "from", etc.). Prevents "Thornwall before" FP when "Thornwall" is in the bible as "Thornwall Citizens".

3. **Standard grounding check:** If the full two-word phrase is in the grounded surface (any tier), suppress it.

## Calibration Results

| Panel | Pre-L23a NER F1 | Post-L23a NER F1 | FP pre | FP post | FP delta |
|-------|----------------|-----------------|--------|---------|----------|
| Small labeled (n=22) | 1.000 (exp #330) | **1.000** | 0 | 0 | **0** |
| Expanded synthetic (n=27) | 1.000 (exp #330) | **1.000** | 0 | 0 | **0** |

Both panels hold at F1=1.000 with 0 FP regressions. Recall=1.000 on all labeled rows — NER catches all oracle-FAIL rows.

## L22 FN Closure

| Entity | Class | Fires? | Notes |
|--------|-------|--------|-------|
| `T.C.` | `initials` | **YES** | `extractEntityCandidates("T.C., Examiner")` → `[{phrase: "T.C.", class: "initials"}]` |
| `Aether waste` | `capitalized-first-only` | **YES** | `runNerPrepass` with `bibleTokens={"aether"}` → `[{phrase: "Aether waste", class: "capitalized-first-only"}]` |
| `T.C.` grounded (roster has Taryn Coombs) | `initials` suppressed | **YES** | `deriveInitials("Taryn Coombs")=["T.C."]` → grounded surface contains "t.c." → `runNerPrepass` suppresses |

## Design Decisions

1. **`extractEntityCandidates` stays pure.** The extractor emits `cap-first-only` candidates unconditionally. FP suppression is in `runNerPrepass` because the bible context is only available there. Callers that bypass `runNerPrepass` must apply their own first-word gate.

2. **Bible-first-word gate (not full grounded set)** for `cap-first-only`. The full grounded set includes character names which generate FPs ("Kael walked"). Only `worldBible.systems + .locations + .cultures` first-word tokens are used as the gate trigger.

3. **Stop-word second-word gate** to handle "Thornwall before" FP. Common prepositions/conjunctions ≥4 chars that would otherwise pass the length filter are excluded.

4. **`[A-Z][a-z]{3,}` first-word minimum (4 chars total)** excludes "The" (3), "She" (3), "But" (3) etc. without needing a stop-word list for the first word.

5. **`[a-z]{4,}` second-word minimum** excludes common 2-3 char function words ("in", "of", "to", "and", "but", "for") without regex alternation.

6. **Calibration script updated** (`ner-vs-llm-calibration.ts`) to apply the same bible-first-word + stop-word gates as `runNerPrepass`, so calibration F1 reflects actual production behavior.

## Schema Change

`NerFinding.class` in `src/agents/halluc-ungrounded/schema.ts` extended:
```
"title-pair" | "capitalized-multi-word" | "suffix-class" | "x-of-y-capitalized" | "number-word-tail" | "initials" | "capitalized-first-only"
```

## Tests

- **Prior tests:** 80/80 pass (all L15 tests preserved)
- **New tests:** 43 new tests added (13 `initials` tests + 8 `deriveInitials` tests + 12 `capitalized-first-only` tests + 4 gate tests + 5 regression guards + 1 enum check)
- **Total:** 123/123 pass in `entity-candidates.test.ts`
- **Halluc-ungrounded tests:** 68/68 pass

## Cost

$0 — code + unit tests only. No LLM calls.

## Conclusion + Action

**SHIPPED.** Both `initials` and `capitalized-first-only` classes land with 0 FP regressions on both calibration panels. The L22 FN targets (`T.C.`, `Aether waste`) both fire correctly. F1=1.000 maintained on small labeled and expanded synthetic panels.

**Action:** L23b handles the remaining two L22 entities (Guildmaster, senior auditors) via v5 prompt + derived title nouns. After L23a + L23b land → re-smoke fantasy-debt to validate end-to-end chapter completion. Deploy before re-smoke.
