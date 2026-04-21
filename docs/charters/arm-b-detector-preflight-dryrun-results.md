---
status: results
kind: experiment-charter-dryrun
name: arm-b-detector-preflight-dryrun
parent-charter: docs/charters/arm-b-detector-preflight.md
date: 2026-04-21
---

# Dry-Run Results — Arm B Detector Preflight §6 Sections Recovery

Preflight-to-the-preflight per `docs/charters/arm-b-detector-preflight.md`
§6. Binary question: can `sections: string[]` be recovered from stored
`llm_calls.user_prompt` via header-prefix merge, with byte-exact
`sections.join("\n\n") === user_prompt` round-trip?

## Target

- **Novel:** `novel-1776690960321` (epic-fantasy, 10 chapters, Salvatore-routed)
- **Scope:** all 314 `beat-writer` rows where `failed IS NOT TRUE`
- **Parser:** `scripts/evals/preflight-arm-b-parity-dryrun.ts`

## Results

**Full-novel yield: 314/314 = 100.00%.**

Stratified check breakdown:

| Sample | Size | Pass | Yield |
|--------|------|------|-------|
| Initial stratified (1 mid-beat per chapter) | 10 | 10 | 100% |
| Sensory + beat-0 edge-case stress | 27 | 27 | 100% |
| Full novel | 314 | 314 | 100% |

Merge-back rule exercise (the hard case — splits that don't start with
a section header and must be glued back to their parent):

- Total merge-back operations across 314 beats: **1205**
- Beats where merge-back fired at least once: **314 (100%)**
- Max merges in a single beat: **17**

The parser is therefore exercised heavily on real production data, not
just a clean happy path.

## Section composition (across passed beats)

Frequency of each section header appearing in the recovered `sections[]`:

- `(beat-spec)` (unheaded prefix): 314 occurrences (100%)
- `CHARACTERS`: 314 (100%)
- `TRANSITION BRIDGE`: present in most mid-chapter beats
- `LANDING TARGET`: present except on last beat of each chapter
- `Sensory:` (compact-mode setting variant): 27 beats — chapter-start
  or location-change beats only
- `BACKGROUND:`: **0 beats** — `resolveReferences()` returned empty
  `refs.context` on every beat of this novel

## Observations

1. **BACKGROUND: zero firings surprise.** The reference-resolver never
   emitted a non-empty context across 314 calls. Two possible reasons:
   (a) resolved references only fire when specific planner output
   patterns exist and this novel didn't have them, (b) a resolver
   regression. Not investigated in this dry-run because the charter's
   parser already handles BACKGROUND as a known header prefix — zero
   occurrences doesn't invalidate the contract. Flagged for a separate
   investigation if the preflight's Arm B enriched-context design
   needs to overlap with resolved-refs content.

2. **SETTING: never fires; only Sensory:.** This novel is Salvatore-
   routed → compact mode is universal → `SETTING:` gets stripped to
   its `Sensory:` sub-line per `beat-context.ts:214-221`. `SETTING:`
   is retained in the parser's header list for non-compact-mode
   generality (would be needed if the full ladder ever runs on a
   non-voice-LoRA writer), but it's not exercised on this novel.

3. **Compact mode confirmed universal on this novel.** The charter's
   §6 requirement that `compactMode` be archived per beat is satisfied
   by the fact that every beat on this novel was generated with
   compact mode ON. If the preflight uses this novel as its source,
   no non-compact-mode beat will appear.

## Verdict per charter §6

> Yield gate: ≥70% recoverable → dry-run passes, write the other three
> components. 10–30% failure on a post-sql/017 novel = abort as
> schema-drift evidence. >30% failure = abort + re-select.

**Yield 100% → PASS.** The header-prefix merge parser correctly
recovers `sections: string[]` from stored `user_prompt` bytes on this
novel. Charter §6's Arm A byte-replay contract is executable against
`novel-1776690960321`. Proceed to implement the three remaining
preflight components:

1. Enriched-context builder (`src/agents/writer/enriched-context.ts`)
2. Preflight runner (`scripts/evals/run-arm-b-preflight.ts`)
3. Adjudication helper (`scripts/evals/preflight-arm-b-adjudicate.ts`)

Parity harness itself (`scripts/evals/preflight-arm-b-parity.ts`) can
reuse the parser in this dry-run script; promote the `recoverSections`
function to a shared helper when the parity harness lands.

## Caveats for the runtime preflight

- If the runtime preflight uses a different source novel, repeat this
  dry-run on that novel before generation. Schema drift between novels
  is possible.
- BACKGROUND-section-never-fires on this novel means the enriched-context
  builder needs to decide whether its targeted-world-slice sub-block
  should coordinate with resolved-refs OR be strictly additive. Flag
  for the builder's design review.
- 27/314 = 8.6% of beats have a Sensory-variant setting. Stratification
  for the preflight should include at least some of these so the
  insertion-before-Sensory path is exercised, not just insertion-at-end.
