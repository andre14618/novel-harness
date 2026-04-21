---
status: proposed
kind: experiment-charter
name: arm-b-detector-preflight
owner: andre
date: 2026-04-21
revision: 9 (post-Codex-RED round 8 — pool-policy contradiction + symmetric gate + exact-pool manifest)
prior-approval-invalidated: 2026-04-21 (revision 6 approved + executed as exp #260; INCONCLUSIVE per charter §3 math error — see docs/charters/arm-b-detector-preflight-results.md)
---

# Experiment Charter — `arm-b-detector-preflight`

Preflight for `replay-ladder-v1` (RED-blocked, commit `33a84f1`). One
question, two arms, **dynamic beat count** (≥8 adjudicated fires/arm or
40 beats cap), human-adjudicated. Named by Codex as the cheapest-untried
counterfactual in the ladder's charter review (job `aabc1fd419f0be2b2`).

Revision 7 addresses the single material flaw surfaced by executing
revision 6 as exp #260 (`docs/charters/arm-b-detector-preflight-results.md`):
the §3 8-fire-per-arm adjudicable floor + §8 20-beat cap were
mathematically incompatible at the V1 28.9% production fire rate that
revision 2 had rebased to. At 20 beats × 0.289 ≈ 5.8 fires/arm
expected, the floor could not be reached in expectation — and the
live run yielded 2 fires on A and 3 on B, locking the verdict to
INCONCLUSIVE regardless of any label pattern.

Revision 7 widens the §8 beat cap to **40**, keeping the 8-fire floor
intact and restoring charter-internal consistency:

    40 beats × 0.289 ≈ 11.6 fires/arm expected (cleanly above the
    8-fire floor with room for stratum-level variance)

The cap must exceed both the expectation AND the per-arm 8-fire minimum
with slack so that a below-expectation run still clears the floor. 40
is the smallest round number that satisfies that. At 30 beats,
expected = 8.67 fires/arm — technically above 8 but with no slack; a
single-sigma-below run (≈ 6.8 fires/arm) would fail the floor.

Revision 7 also:

- Preserves revision 6's full §6 parity contract, stratification
  predicates, UNCLEAR-exclusion policy, 12.5pt/25pt decision bands,
  and byte-replay Arm A contract. Those were all proven sound by the
  exp #260 live run (100% parity yield, 0 writer errors, clean
  detector calls, clean DB writes). No structural changes beyond the
  cap widen.
- Updates §8 budget to reflect 4× scale (not 2× — writer cost is
  linear in beats but human adjudication time scales with the fire
  count, which at the new cap is ~2× the revision-6 expected load).
- Adds an explicit floor-vs-cap consistency note in §3 so the
  invariant that produced the revision-6 bug is named, not implicit.

Revision 5 addresses one round-4 residual blocker (job
`ac683bf10b86afc5c`): Arm A replay overclaimed recoverability of
`preResolvedRefs` from `llm_calls.request_json`, but `src/llm.ts:197`
strips prompts from the envelope before persisting. Revision 5
reframes Arm A as byte-replay of the stored production `system_prompt`
+ `user_prompt` columns (no `buildBeatContext` re-execution needed),
adds a mandatory offline-archival dry-run (the §5 counterfactual from
round 4) that recovers `sections[]` from the stored `user_prompt` via
header-prefix parsing, and confirms the resolver-LLM-fallback /
relationship-state-DB-read non-determinism paths are avoided entirely
because Arm B also constructs from Arm A's recovered sections[] rather
than re-running `buildBeatContext`.

Revision 4 addressed two round-3 residual blockers. Revision 3
addressed two round-2 blockers. Revision 2 addressed five round-1
blockers. Full chain preserved in §10.

Legacy context (retained for reference):
Revision 2 addressed five round-1 blockers. Revision 3 addressed two
round-2 blockers (outcome-table overlap + parity-contract mismatch).
Revision 4 addressed two round-3 residual blockers (job
`a233169484d5102a1`): (a) band-value inconsistency — §1, §3, and §5
still carried stale 10pt / 10–15pt language after §7's bands were
recalibrated to 12.5pt/25pt, leaving a `-12.4pt` result as both GO
(§7) and "not within 10pt" (§1); revision 4 aligns every band
reference to the discretization-calibrated values; (b) parity contract
underspecified resolver replay — `buildBeatContext` takes
`preResolvedRefs` as input (`src/phases/drafting.ts` → `beat-context.ts:
207`) and falls back to an LLM-capable `resolveReferences()` on miss,
so Arm A replay without archived `preResolvedRefs` is non-deterministic;
revision 4 enumerates the full archival-field list, corrects the refs
section header from "position-with-no-header" to `BACKGROUND:` per
`reference-resolver.ts:150`, and adds a cross-cut §4.7 field-check
contract covering systemPrompt / model / provider / temperature /
maxTokens / responseFormat.

## 1. Question

Does the `halluc-ungrounded` detector — calibrated against current
production context per exp #254 (`beat-entity-list-v1`) — remain usable
as a primary oracle on prose generated under a **new context
distribution** (enriched context: `speaker_directives` + reader-info
state slice + targeted world-bible expansion keyed to beat entities)?

Restated as a falsifiable concrete: is detector precision on Arm B
prose within 12.5pt (one label at the 8-fire discretization floor;
see §7) of detector precision on Arm A prose?

Per `experiment-design-rules.md` §3.2 / §9.2 / §11.6, a production-
calibrated detector is a provisional instrument when the input
distribution changes. The full `replay-ladder-v1` charter assumed the
detector stays usable across Arms A/B/C/D; Codex adversarial flagged
this as an unvalidated assumption (Blocker #2, 2026-04-21). This
preflight resolves the assumption directly before committing to the
full ladder.

## 2. Hypothesis

**If** we regenerate a pre-registered stratified pool of beats (up to
40 per §3 dynamic stop rule) through two arms (A: baseline, B: +enriched
context) and adjudicate every `halluc-ungrounded` detector fire on each
arm against a shared human-labeled ground-truth (TP / FP / UNCLEAR),
**then** detector precision on Arm B will be within one-label-of-noise
of detector precision on Arm A (precision band calibrated to the
minimum-8-fires adjudication floor — see §7), **because** the enriched-
context block
widens the grounded surface for legitimate entity references without
introducing an entity substrate the detector's training distribution
lacks coverage for.

No directional prediction on recall — the enriched context should
monotonically *reduce* legitimate false positives (entities that were
flagged as ungrounded because the checker didn't see the grounded
source), so raw fire-rate may drop while precision stays flat. Recall
drift is the mechanism under test indirectly; precision shift is the
load-bearing signal.

## 3. Falsification threshold

Stated before results. Sample-size rebased against exp #254's shipped
V1 baseline (28.9% fire rate) and against the exp #260 live-run
observation (20% on arm A, 30% on arm B, right at expectation).

**Floor-vs-cap consistency check (heuristic — named here so it cannot
go implicit across revisions).** The §8 beat cap must be large enough
that the expected fire count on the chosen source novel MINUS one-sigma
variance still exceeds the §3 adjudicable floor on each arm. This is a
DESIGN HEURISTIC, not a probabilistic bound: it treats per-beat fires
as iid Bernoulli with fire rate `p` measured on the source novel,
which overstates certainty under §6's deliberate stratification
(stratum-specific rates differ — see audit below). The heuristic's
purpose is to catch gross mismatches (revision 6's infeasibility) not
to guarantee coverage — that's what the INCONCLUSIVE outcome in §7 is
for.

At V1 production fire rate p = 0.289 (cross-novel average, from exp
#254's shipped-V1 panel) with one-sigma variance `sqrt(N*p*(1-p))`:

    | N  | expected | 1-sigma below  |
    |----|----------|----------------|
    | 20 |  5.78    |  3.75  ← below floor; revision 6 ran here |
    | 30 |  8.67    |  6.19  ← below floor; too tight |
    | 40 | 11.56    |  8.72  ← above floor; revision 7+ choose here |

**Source-novel eligibility gate (SYMMETRIC — revision 9, addressing
Codex round-8 blocker #2).** The chosen source novel's MEASURED overall
halluc-ungrounded fire rate must satisfy:

    measured_p_overall ∈ [0.24, 0.34]  (HARD bounds, both tails)

Below band → re-select (as happened with `novel-1776690960321` at 16.1%).
Above band → re-select (the revision-8 carve-out "may still be used but
log the deviation" has been removed, per Codex round-8 blocker #2 —
asymmetric bounds create a cherry-picking path where easier high-fire
novels produce spuriously strong GO verdicts).

Before any generation spend, `scripts/evals/preflight-arm-b-stratum-audit.ts`
(spec in §9) re-runs the stratum classification against the chosen
novel's historical `llm_calls` and asserts eligibility.

**Exact-pool feasibility manifest (revision 9, addressing Codex round-8
blocker #1).** The charter commits to a single unambiguous pool-selection
policy and materializes the realized pool manifest at
`output/evals/arm-b-preflight-pool-manifest-rev9.json`. Floor-clearance
math is computed from the manifest's actual per-stratum Poisson-binomial
bounds, NOT from the IID heuristic table above.

Pool-selection policy (revision 9 — see §6 for the executable predicates):

    1. Take up to 16 lore-heavy beats ordered by (chapter, beat_index) asc
    2. Take up to 10 state-leaning beats ordered the same way
    3. Fill the remaining slots to N=40 from the "none" fallback stratum
       (ordered the same way)

Dialogue-heavy stratum has been DROPPED from the target composition
per the revision-8 audit finding: on every candidate novel tested, the
planner-assigned `kind='dialogue'` predicate yields ≤2 qualifying beats
with 0% fire rate. The stratum contributes zero signal and depresses
expected fires/arm when it's included. (The predicate remains in §6
as a descriptive-only classification for the results writeup, but
does not drive pool selection.)

Realized pool on the chosen novel (`novel-1776690840208`) — canonical
numbers from `scripts/evals/preflight-arm-b-stratum-audit.ts` output
on 2026-04-21:

    | stratum | count | measured_p | expected fires |
    |---------|-------|------------|----------------|
    | lore    |   16  |    31.25%  |      5.00      |
    | state   |   10  |    20.00%  |      2.00      |
    | none    |   14  |    31.30%  |      4.38      |
    | total   |   40  |       —    |     11.38      |

Poisson-binomial std = 2.84; **1-sigma below = 8.55**. Clears the
8-fire adjudicable floor with ~0.55 slack — tight but real. The
INCONCLUSIVE outcome in §7 remains the safety net for runs that dip
below 8 despite the 0.55-σ buffer.

**Measured rates on candidate novels** (pre-registered audit result,
2026-04-21, query against `llm_calls` response_content pass field):

    | novel_id                          | rate    | beats | eligible? |
    |-----------------------------------|---------|-------|-----------|
    | novel-1776698676238               | 44.9%   |   98  | above band; deferred to cross-check |
    | novel-1776617131094               | 36.2%   |   69  | above band; too small |
    | novel-1776737831613               | 31.7%   |  123  | above band |
    | novel-1776690840208               | 30.1%   |  305  | **in band — chosen** |
    | novel-1776698676238-v1            | 28.9%   |  128  | in band; alternate |
    | novel-1776686559204               | 21.5%   |  209  | below band; REJECTED |
    | novel-1776690960321 (revision 7)  | 16.1%   |  311  | below band; REJECTED (revision-7 initial target) |

**Chosen source novel: `novel-1776690840208`** (epic-fantasy,
Salvatore-routed, 10 approved chapters, 30.1% overall halluc-ungrounded
fire rate). Stratum breakdown on this novel:

- dialogue-heavy (§6 predicate): 2 qualifying / 0 fires = 0% (sparse)
- lore-heavy: 16 qualifying / 5 fires = 31.3%
- state-leaning: 10 qualifying / 2 fires = 20.0%
- none (§6 fallback): 115 qualifying / 36 fires = 31.3%

The dialogue-heavy stratum is consistently sparse across all candidate
novels — the planner rarely assigns `kind='dialogue'`. Revision 8 keeps
the dialogue target (16 of 40) but expects the selection logic to fall
through to other strata when dialogue-qualifying beats are below target.
This is not a charter failure; §6 already permits smaller-than-target
per-stratum fills as long as the 40-beat cap is respected.

Below-sigma runs are still possible (the run could produce <8 fires on
one arm even at 40 beats on a 30%-rate novel) — that case is handled
by the INCONCLUSIVE outcome in §7, not by re-running.

- **Dynamic stop rule:** generate beats sequentially. After each beat,
  count cumulative adjudicable fires per arm (fires excluding UNCLEAR;
  see §7). Stop when either (a) both arms have ≥8 adjudicable fires,
  OR (b) **40 beats** have been generated. Beats are generated in the
  pre-registered stratum order from §6, so sampling is still
  reproducible.
- **Detector precision on Arm B drops >25pt vs Arm A** (post-stop,
  computed per §7 formula — band calibrated to the 8-fire discretization
  floor: one label at that sample is 12.5pt, so >25pt = ≥2 labels of
  drop, unambiguous degradation). Detector generalizes poorly to the
  enriched-context distribution. KILL detector-as-primary-oracle on
  Arm B of the full ladder; revise `replay-ladder-v1` Arm B oracle
  to human adjudication primary, detector exploratory only.
- **Fewer than 8 adjudicable fires on either arm at the 40-beat cap.**
  Even-at-expectation produced a below-sigma run. Measurement too
  sparse for the 12.5pt / 25pt decision band. Abort; record as
  inconclusive. The right corrective is either a higher-fire-prior
  beat stratum, a different detector, or a fire-rate-tolerant oracle
  (not another ratchet of the beat cap — 40 is already calibrated
  against 1-sigma-below expectation per the floor/cap invariant
  table above).
- **Human adjudicator self-disagrees on ≥2 of the 4 silent retest
  adjudications** (see §7 — 4 pre-registered adjudications are silently
  re-presented in shuffled order + arm-masked at the end of the pass).
  Adjudicator reliability insufficient; ground-truth labels are noisy
  at the level the precision band requires. KILL this preflight; do
  not report a precision number derived from unreliable labels.
  Escalate to a calibration workshop or second adjudicator before any
  future preflight of this shape.
- **UNCLEAR rate exceeds 25% of fires on either arm** (see §7). The
  adjudication policy — not the detector — is driving the signal.
  Do not emit a GO/CAUTION/NO-GO from this run. Re-adjudicate the
  UNCLEAR set with a second-pass protocol (separate session, relaxed
  ambiguity rule) and re-decide.

## 4. Baseline ladder

| Slot | Arm label | What it is |
|------|-----------|------------|
| Current prod | **A: baseline** | Salvatore v4 voice-LoRA + current production beat-context |
| Intervention | **B: +enriched context** | Same writer + enriched beat-context block (`speaker_directives` + reader-info state + targeted world-bible expansion) |

No floor, no ceiling arm — this is a two-point precision comparison,
not a ranking. Per `experiment-design-rules.md` §2.1, the floor /
ceiling ladder requirement applies to capability experiments, not
instrument-validation preflights.

## 5. Cheapest counterfactuals considered

| Lever | Est cost | Rejected because |
|-------|----------|------------------|
| Skip preflight, run `replay-ladder-v1` directly with detector as oracle | $2 | Rejected by Codex charter review (verdict RED, 2026-04-21) — detector validity under enriched-context shift is the load-bearing assumption the full ladder cannot test from within its own design |
| Skip preflight, run `replay-ladder-v1` with human-only oracle on all arms | $2 + 4–6h human time | Scope creep; preflight answer may obviate the human oracle on Arms A/C/D where the detector is already calibrated |
| Detector adjudication on Arm A alone (sanity check only) | $0.25 + 30min | Doesn't answer the distribution-shift question — Arm A is the calibration distribution |
| Keep revision 6 cap (20 beats) | exp #260 ran this — $0.0023 + zero adjudication time | REJECTED BY EXECUTION: produced 2 fires A, 3 fires B at V1 rate, locked the verdict to INCONCLUSIVE regardless of label pattern. The 8-fire floor is not reachable in expectation at N=20. |
| Lower the floor instead of widening the cap (e.g., 4 fires/arm) | $0.0023 + ~30min | Rejected: at 4 fires/arm the discretization step is 25pt (1 label), which is equal to the NO-GO threshold. Any interior verdict becomes indistinguishable from noise. The floor is load-bearing. |
| Widen the cap to 30 | $0.005 + ~2h | Rejected: 30 beats yields 8.67 fires/arm expected — above the floor but with zero variance slack. One-sigma-below runs produce ~6.8 fires/arm, re-triggering INCONCLUSIVE. 30 is the smallest cap that satisfies expectation-only; 40 is the smallest that satisfies expectation AND 1-sigma-below. |
| Switch detector to adherence-events or combined beat-checks (46.7% prod rate) | $0.01 + 3h | Deferred as the Option 3 successor (separate charter) per `docs/charters/arm-b-detector-preflight-results.md`. Changes the measurement question ("does context preserve aggregated beat-check precision" vs "does context preserve halluc-ungrounded precision"). Correct-scale but larger scope than a floor fix. |

## 6. Distribution match

**Novel selection.** Revision 8 target: **`novel-1776690840208`**
(epic-fantasy, Salvatore-routed, 10 approved chapters, 30.1% measured
halluc-ungrounded fire rate — in the §3 eligibility band `[0.24, 0.34]`).
Selected after the revision-7-initial target `novel-1776690960321`
(16.1% rate) was invalidated by the §3 source-novel eligibility gate.
Full candidate table in §3. If `novel-1776690840208` becomes unavailable
at run time (deleted / schema-drifted / etc.), the §3 alternate is
`novel-1776698676238-v1` at 28.9% — re-review not required if the
alternate is used and logged.

**Stratum-rate audit pre-run (mandatory, §3 gate).** Before the parity
dry-run generates the baseline, `scripts/evals/preflight-arm-b-stratum-audit.ts`
(to create per §9) re-runs the stratum classification against the
chosen novel's historical `llm_calls` to confirm the overall fire rate
is still in the eligibility band and to log per-stratum fire rates to
the charter's results memo. If the re-audit rate is outside `[0.24,
0.34]` at run time (e.g., rates drifted due to schema changes), ABORT
and re-select novel.

**Stratification** — executable rules against the live schema
(`src/schemas/shared.ts:38` `sceneBeatSchema` — fields `characters:
string[]`, `kind: "action" | "dialogue" | "interiority" | "description"`,
`description: string`). Used at both initial pool selection (up to 40
beats — the revision-7 §8 cap) and stop-rule termination.

Pool composition (revision 9 — unambiguous single policy per Codex
round-8 blocker #1 resolution). The dialogue-heavy stratum is DROPPED
from the target because the planner-emitted `kind='dialogue'`
predicate is sparse across all audited candidate novels (≤ 2 qualifying
beats per novel with 0% fire rate — dead signal, not useful
stratification). The dialogue-heavy predicate remains here as a
descriptive-only classification for the results writeup.

Policy — at the 40-beat cap:

- **Lore-heavy — up to 16 of 40 beats, ordered by (chapter, beat_index)
  ascending.** Deficit (fewer than 16 qualifying beats) reallocates to
  the `none` fallback.
- **State-leaning — up to 10 of 40 beats.** Deficit reallocates to
  `none`.
- **`none` fallback — fills remaining slots to reach N=40.**
- **Dialogue-heavy — 0 target** (predicate preserved for descriptive
  classification only; see above).

Predicates:

- **Dialogue-heavy (descriptive):** Primary predicate: `beat.kind ===
  "dialogue"` AND `beat.characters.length ≥ 3`. Fallback (ORed in) if
  primary set is under target: beats where the production prose
  contains ≥ 4 dialogue-tagged matches of the regex
  `/"[^"]{5,}"[\s\S]{0,30}?(said|asked|replied|whispered|shouted|muttered|called|answered)/gi`
  executed against the `llm_calls.response_content` of the approved
  beat-writer row. Regex is documented as a fallback heuristic, not a
  primary signal. Brittle-match disclaimer is acceptable for this role.
- **Lore-heavy — up to 16 of 40 beats.** `beat.description` contains a
  case-insensitive word-boundary match for any entity name from the
  entity set constructed at query time:

      entities = worldBible.locations.map(l => l.name)
               ∪ worldBible.cultures.map(c => c.name)
               ∪ worldBible.systems.map(s => s.name)

  Normalization: each entity name is lowercased, stripped of possessive
  suffixes (`'s`, `'`), and wrapped in `\b`-equivalent word-boundary
  assertions per the pattern used by `regexLeakMatches` in
  `src/agents/halluc-leak-salvatore/regex-leak.ts:52`. Any entity
  shorter than 4 characters is excluded (reduces false-match rate,
  matches the existing regex-leak filter). **AND** the matched entity
  must NOT appear in any earlier beat's `description` in the same
  chapter (checked by running the same normalized regex against each
  prior `scenes[i].description` for `i < beatIndex`).
- **State-leaning — up to 10 of 40 beats.** `chapter ≥ 3` AND
  `beat.description` matches the case-insensitive regex
  `/\b(remember(s|ed|ing)?|recall(s|ed|ing)?|know(s|n|ew)?|recogni[sz]e(s|d|ing)?|wonder(s|ed|ing)?\s+whether|already|still|again|(for|since)\s+(the|her|his|their)\s+(first|last))\b/i`.
  Pattern is checked into the runner script and committed before any
  generation.

**Deterministic selection with reallocate-to-none deficit policy
(revision 9 — single unambiguous policy per Codex round-8 blocker #1).**
For each stratum in priority order [lore, state]:

    take min(target, len(stratum)) from the stratum, ordered
    ascending by (chapter, beat_index)

Any deficit (target − realized) is reallocated to the `none` fallback
rather than left as a smaller pool. The `none` stratum fills whatever
remains to reach N=40 after lore + state are filled. If the union of
all strata's available beats is < 40, the preflight is infeasible on
this novel and §3's source-novel gate re-runs against an alternate.

This is the policy audited in §3's exact-pool manifest: on
`novel-1776690840208` the policy yields 16 lore + 10 state + 14 none
= 40 beats, with Poisson-binomial 1-σ-below of 8.48 clearing the
8-fire floor by ~0.48.

The previous revision's contradictory "fall through to other strata"
language (§3) vs "NOT reallocated, proceeds with smaller pool" (§6)
has been resolved: reallocate-to-none is the single policy.

**Parity harness** — tightened against the live assembly path in
`src/agents/writer/beat-context.ts:143-229`.

- **Script:** `scripts/evals/preflight-arm-b-parity.ts` (to create).
  Implements structured-segment diff per `experiment-design-rules.md`
  §4.7 extending the structure from
  `scripts/evals/conditioning-floor-parity-check.ts`.
- **Sections recovery from stored `user_prompt` bytes.** `beat-context.ts:
  227` joins sections with `\n\n`, and in non-compact mode the
  CHARACTERS section at `beat-context.ts:195-199` contains internal
  `\n\n` delimiters via `snapshots.join("\n\n")`. A naive
  `userPrompt.split("\n\n")` cannot recover the original `sections[]`.
  The dry-run parser therefore splits on `\n\n` and then merges
  adjacent splits back into a single section whenever the second split
  does NOT start with a recognized section-header prefix. Header-prefix
  list is the closed set below. The beat-spec section at index 0 has
  no fixed header; the parser treats everything before the first
  recognized header as the beat-spec section.
- **Live section structure is conditional**, not fixed-index. Present
  (and in this order) only when their trigger holds:

      [Beat spec]              always present (index 0)
      [TRANSITION BRIDGE]      only if previousBeatProse exists (chapter 1 beat 0 omits)
      [LANDING TARGET]         only if outline.scenes[beatIndex+1] exists (last beat omits)
      [CHARACTERS]             only if beatChars.length > 0
      [BACKGROUND]             only if refs.context non-empty (header emitted by reference-resolver.ts:150)
      [SETTING / Sensory:]     only if beatIndex === 0 OR beatHasLocationChange()

  Section identity is detected by header prefix: `TRANSITION BRIDGE`,
  `LANDING TARGET`, `CHARACTERS:`, `BACKGROUND:`, or `SETTING:` /
  `Sensory:`. The beat-spec section at index 0 is identified by
  position, not by a header prefix.
- **Arm A replay = byte-replay of the stored production prompt, not
  re-execution of `buildBeatContext`.** `src/llm.ts:197`
  (`requestEnvelopeForLog`) strips `systemPrompt` and `userPrompt`
  from the JSON envelope and persists them in the dedicated
  `llm_calls.system_prompt` and `llm_calls.user_prompt` columns. The
  stored prompt bytes ARE the archival record — no reconstruction
  of `preResolvedRefs` (or any other `buildBeatContext` input) is
  needed or possible from the envelope alone. Arm A replay sends the
  stored `system_prompt` + `user_prompt` verbatim to the writer
  model with the persisted envelope fields (model, provider,
  temperature, maxTokens, responseFormat) byte-equal to the original.
- **Arm A recoverability check — offline archival dry-run (§5
  counterfactual, mandatory pre-flight to the pre-flight).** Before
  any beat generation, run the dry-run:

      1. For each beat in the pre-registered pool, pull the
         `llm_calls` row with `agent='beat-writer'`, `failed IS NOT
         TRUE`, matching (novel_id, chapter, beat_index), ordered by
         `id ASC LIMIT 1`.
      2. Assert `system_prompt IS NOT NULL`, `user_prompt IS NOT
         NULL`, and all required envelope fields present on
         `request_json`.
      3. Parse `user_prompt` into `sections[]` by splitting on `\n\n`
         and then merging adjacent splits into a single section when
         the second split does NOT start with a recognized section
         header prefix (`TRANSITION BRIDGE`, `LANDING TARGET`,
         `CHARACTERS:`, `BACKGROUND:`, `SETTING:`, `Sensory:`). This
         recovers `sections[]` even though the CHARACTERS section
         contains internal `\n\n` delimiters in non-compact mode
         (`beat-context.ts:195`).
      4. Archive BOTH (a) the full recovered sections[] as
         `sections: string[]` (the actual section strings — needed
         at runtime to construct Arm B and verify byte-equality
         post-insertion) AND (b) a per-section integrity signature
         (header prefix + byte length + SHA-256) to
         `scripts/evals/preflight-arm-b-parity-baseline.json`. The
         signature is used to detect tampering/drift between dry-run
         and runtime; the section strings are used for construction
         and comparison. Also archive the persisted envelope fields
         (`model`, `provider`, `temperature`, `maxTokens`,
         `responseFormat`) and the full `system_prompt` column.

  Any beat whose row can't satisfy steps 2–4 is dropped from the
  pool. If more than 30% of the pool is unrecoverable, abort the
  preflight and re-select — the source novel is too old or too
  schema-drifted to support the contract. Do not proceed with
  a partial pool.

  The 30% threshold is heuristic — per `experiment-design-rules.md`
  §11.6 any non-trivial miss rate on a post-`sql/017_llm_call_inspection.sql`
  novel (which is when the `system_prompt` / `user_prompt` columns
  were added) should be treated as schema-drift evidence and
  investigated before proceeding, not averaged over. If the dry-run
  miss rate is 10–30% on a recent novel, abort anyway and record the
  schema-drift symptom.
- **Arm B construction — operate on Arm A's recovered `sections[]`,
  not on live `buildBeatContext`.** Arm B builds its prompt by
  inserting exactly one new `ENRICHED CONTEXT:` section into Arm A's
  recovered `sections[]` at the setting-anchor position defined
  above, then joining with `\n\n` to produce the Arm B user_prompt.
  Arm B's system_prompt and envelope fields are byte-equal to
  Arm A's. This avoids the `buildBeatContext` non-determinism path
  (no `resolveReferences()` LLM fallback risk; no relationship-state
  DB read from `getRelationshipBetween()` at `beat-context.ts:286`
  — addressed in Codex round-4 warning — because we are not calling
  `buildBeatContext` at all).
- **Parity check (runtime, per beat):**

      1. Load Arm A's recovered sections[] from the archival baseline.
      2. Build Arm B's sections[] by inserting the ENRICHED CONTEXT
         block at the setting-anchor position.
      3. Assert len(Arm B sections) == len(Arm A sections) + 1.
      4. Find the ENRICHED CONTEXT section in Arm B (must appear
         exactly once, with header prefix `ENRICHED CONTEXT:`).
      5. Remove it from Arm B's sections to produce sections_B'.
      6. Assert sections_B' == Arm A sections byte-equal by index.
      7. Assert Arm B's system_prompt == Arm A's system_prompt byte-
         equal. Assert Arm B's envelope fields (model, provider,
         temperature, maxTokens, responseFormat) all byte-equal to
         Arm A's.

- **Abort condition:** any violation of steps 3–7 fails parity for
  that beat. Log the structured diff (showing per-index section
  identity + byte length + first divergence offset) and abort the
  preflight — do not silently re-emit.
- **Cross-cut parity fields (per `experiment-design-rules.md` §4.7).**
  Steps 7 above cover this. `llm_calls.request_json` carries
  timestamp-adjacent fields (e.g., request_id, a tracing id) that
  are NOT part of the envelope whitelist and are excluded from the
  byte-equality check. The whitelist is explicitly: `model`,
  `provider`, `temperature`, `maxTokens`, `responseFormat`, plus
  `system_prompt` and `user_prompt` columns. Any other field
  variation is tolerated (and expected).
- **Arm B invariant — relative to setting anchor, not absolute index.**
  Exactly ONE new section is inserted into Arm B's `sections[]` with
  the header prefix `ENRICHED CONTEXT:`. Insertion position:

      if sections contains a SETTING / Sensory: section:
          insert immediately before that section
      else:
          insert at the end of the array

  All other sections must be byte-equal to Arm A's `sections[]` at
  their **matched index after insertion** (not raw index). The parity
  check:

      1. Assert `len(sections_B) == len(sections_A) + 1`
      2. Find the ENRICHED CONTEXT section in sections_B (must appear
         exactly once)
      3. Remove that section from sections_B to produce sections_B'
      4. Assert `sections_B' == sections_A` byte-equal by index

- **ENRICHED CONTEXT section content** (single `\n\n`-delimited entry
  in `sections[]`, containing three labeled sub-blocks separated by
  single blank lines — which collapses to one array entry because the
  whole block is pushed onto `sections[]` as a single string):

      ENRICHED CONTEXT:

      SPEAKER DIRECTIVES:
      …

      READER-INFO STATE:
      …

      FOCUSED WORLD SLICE:
      …

- **Abort condition:** any violation of steps 1–4 fails parity for
  that beat. Log the structured diff (showing per-index section
  identity + byte length + first divergence offset) and abort the
  preflight — do not silently re-emit.

## 7. Success criteria

**Oracle: human adjudication on masked evidence packets.** For each
detector fire, the adjudicator receives a packet containing:

- The prose span (with the fired entity highlighted)
- The full writer-visible context the writer saw: beat spec, transition
  bridge, landing target, character block, resolved references, and
  setting (per the §6 section structure). Arm B packets additionally
  contain the `ENRICHED CONTEXT:` block.
- Arm identity is **hypothesis-masked** (the adjudicator is not told
  which arm this is) but enriched-context packets are identifiable by
  the block presence. Packet ordering is randomized. Arm identity is
  revealed only after all adjudications are submitted.

Adjudication labels:

- **TP** — The fired entity is genuinely ungrounded given the full
  writer-visible context. Detector was correct.
- **FP** — The entity is grounded by something the adjudicator can
  point to in the visible context. Detector was wrong.
- **UNCLEAR** — The grounding is ambiguous (e.g., the entity is
  arguably implied by a higher-level source but not explicitly named).
  The adjudicator MUST write a one-sentence reason. **UNCLEAR rows
  are excluded from the precision denominator** and tracked as a
  separate count per arm.

This is deliberate: lumping UNCLEAR into FP asymmetrically penalizes
Arm B (where enriched context changes what counts as grounded), and
exp #254's calibration precedent used straight TP/FP adjudication
without a third bucket. Per §3, the preflight auto-aborts if UNCLEAR
exceeds 25% of fires on either arm — at that rate the policy, not
the detector, is driving the signal.

**Sampled non-fire audit** — 3 random non-fire beats per arm get
adjudicated for potential FN (real ungrounded entity the detector
missed). This is **descriptive only**, not a recall claim. At N=3
per arm the audit cannot support any quantitative recall conclusion
(Codex YELLOW warning, 2026-04-21); it exists to surface egregious
false-negatives only.

**Adjudicator self-consistency check** — 4 adjudications are randomly
sampled from the submitted set and silently re-presented at the end
of the pass (position-shuffled, arm-masked, packet content identical).
Rule: kill the preflight if the adjudicator flips on **≥2 of the 4**
retests. At 4 retests × 2-label space (TP / FP; UNCLEAR allowed),
chance-flip expectation is low enough that ≥2 flips is evidence of
unreliability rather than noise. If 1 flip: warn in the writeup but
do not kill.

**Primary metric — precision per arm (UNCLEAR-excluded):**

    precision_arm = TP_arm / (TP_arm + FP_arm)

computed across all adjudicable fires on that arm at stop time.
`unclear_rate_arm = UNCLEAR_arm / (TP_arm + FP_arm + UNCLEAR_arm)`
is tracked and reported per §3.

**Decision bands calibrated to the 8-fire discretization floor.** At
the minimum stop-rule sample of 8 adjudicable fires per arm, one
label flip moves precision by 12.5pt. Bands narrower than that are
sub-label-resolution noise; the round-1 10pt/15pt bands could not be
resolved at the minimum floor. Bands are rounded up to clean label
multiples and held fixed even when the stop rule yields more than
8 fires — so the decision rule is pre-registered, not data-adaptive.

- **GO band:** `precision_B − precision_A ≥ −12.5pt` (at most one
  label of drop — within noise)
- **CAUTION band:** `−25pt ≤ precision_B − precision_A < −12.5pt`
  (one-to-two labels of drop)
- **NO-GO band:** `precision_B − precision_A < −25pt` (≥ two labels
  of drop — unambiguous degradation)

**Outcome table — evaluated top-down, first match applies. This
precedence removes the round-2 overlap where `<8 fires` + `precision
looks good` routed to both INCONCLUSIVE (§3) and CAUTION (§7).
INCONCLUSIVE now wins every time: if you didn't hit the sample floor
or policy floor, the precision comparison is untrusted regardless of
value.**

| Outcome | Precedence / Condition | Action |
|---------|------------------------|--------|
| **INCONCLUSIVE** | Checked FIRST. Fires on either arm < 8 at 40-beat cap, OR UNCLEAR rate > 25% on either arm (§3), OR ≥ 2/4 retest flips (§3). | Record inconclusive. Do NOT emit GO/CAUTION/NO-GO. Re-charter with higher-fire-prior stratum, different detector, or revised adjudication policy. |
| **NO-GO** | Checked second. `precision_B − precision_A < −25pt`. | Detector-as-primary-oracle not viable on Arm B. Redesign `replay-ladder-v1` Arm B oracle to human-adjudication primary. |
| **CAUTION** | Checked third. `−25pt ≤ precision_B − precision_A < −12.5pt`. | Proceed to full ladder but downgrade Arm B detector evidence to secondary; add a 10-beat human sidecar on Arm B specifically for prose-quality check. |
| **GO** | Default when none of the above apply. Implies `precision_B − precision_A ≥ −12.5pt` AND both arms met 8-fire floor AND UNCLEAR ≤ 25% both arms AND retest consistency passed. | Proceed to revise `replay-ladder-v1` with detector as primary oracle on Arm B (retain other blockers' fixes). |

**Scope limit of a NO-GO** — per §11.5 and Codex warning 2026-04-21:
a NO-GO on this preflight invalidates the detector on the *bundled*
enriched-context package (speaker_directives + reader-info +
focused-world-slice together). It does NOT invalidate any sub-block
individually. Claims about which sub-block is causal require a
separate ablation charter.

**Secondary observations (report but do not gate on):**
- Fire-rate delta — directional signal on whether enriched context is
  reducing flags (expected but not tested here)
- Sampled FN count per arm — qualitative only, no recall claim per §3.1
- Stratum breakdown of precision — does the signal concentrate in
  dialogue vs lore vs state beats?
- UNCLEAR rate per arm — if close to the 25% abort threshold, record
  for future-charter policy improvement

## 8. Budget

Recalibrated in revision 7 against the 40-beat cap (2× revision 6's
prior cap) and exp #260's observed per-beat cost (~$0.00023, 4× lower
than the revision-2 estimate because the Salvatore v4 LoRA is cheaper
in practice than the speculative $0.02/call).

- **Spend cap:** $4 hard. Expected: 2 arms × up to 40 beats = ≤80
  writer calls at exp #260's observed ~$0.00023/call = ~$0.02 writer
  spend. Plus ≤80 halluc-ungrounded detector calls at similar
  W&B Inference rates = ~$0.02. The $4 cap leaves 100× headroom for
  regeneration, detector retries, or a LoRA-pricing-model change.
- **Wall-clock cap:** 4 hours from charter GREEN to result table
  committed. Writer + detector generation ~25 min (sequential through
  W&B Inference; exp #260 produced 10 beats in ~6 min, scale 4×);
  parity harness ~10 min; adjudication pass up to 3h (see below);
  writeup ~30 min.
- **Human-time cap:** 3 hours for adjudication. Expected load at
  V1 fire rate (28.9%) on 40 beats: ~11.6 fires/arm × 2 arms +
  6 non-fire audits (3 per arm) + 4 silent retests sampled from fires
  = ~33 distinct packets at ~4–5 min each. Upper bound at expectation
  plus 1-sigma (≈ 14.4 fires/arm) is ~39 packets ≈ 3h. Split across
  two sessions if the count approaches the upper bound — preserves
  adjudicator reliability per §7's retest-consistency check.
- **Stop if:** parity harness reports delta outside whitelisted span on
  any beat (§6 abort condition); either arm fails to reach 8
  adjudicable fires by the 40-beat cap (§3 INCONCLUSIVE —
  calibrated against 1-sigma-below expectation, so this would be a
  genuinely anomalous run); adjudicator self-disagrees on ≥2/4
  retests (§3 retest kill); UNCLEAR rate >25% on either arm (§3
  UNCLEAR abort); any beat generation errors on Arm A (baseline
  stability issue — bigger problem than this preflight).

## 9. Linked context

- **Parent charter (BLOCKED on this preflight's result):**
  `docs/charters/replay-ladder-v1.md` — commit `33a84f1` has the §10
  Codex RED verdict with the cheapest-untried counterfactual pointer.
- **Detector calibration precedent:**
  - exp #254 (`beat-entity-list-v1`) — 44.9% → 28.9% fire rate, 87.5%
    precision via 10-fire Sonnet adjudication. This preflight's
    adjudication protocol extends that design to a cross-arm comparison.
- **Related decisions:**
  - `docs/decisions.md` 2026-04-20: "beat-entity-list V1 shipped" — the
    production-calibration point this preflight revalidates
  - `docs/decisions.md` 2026-04-21: "Rewrite-capability probe" — source
    of the "V1 anchor" concern that motivates holding the writer
    constant in this preflight
- **Code already committed (revision 6 execution):**
  - Enriched-context builder: `src/agents/writer/enriched-context.ts`
    (commit `4c2ba6e`; feature-flagged, never imported from production)
  - Shared section parser: `scripts/evals/beat-prompt-sections.ts`
    (commit `d0a95f7`)
  - Parity harness: `scripts/evals/preflight-arm-b-parity.ts` (commits
    `d0a95f7`, `0ff8646`)
  - Preflight runner: `scripts/evals/run-arm-b-preflight.ts` (commit
    `4fb8001`)
  - Adjudication helper: `scripts/evals/preflight-arm-b-adjudicate.ts`
    (commits `f17bd4b`, `0ff8646`)
- **Pre-registered artifacts (revision 9):**
  - Exact-pool manifest: generated by the stratum-audit script below
    into `output/evals/arm-b-preflight-pool-manifest-rev9.json`.
    `output/` is gitignored (runtime artifact), but the key numbers
    are committed inline in §3 (stratum counts, per-stratum measured
    fire rates, expected fires/arm, Poisson-binomial 1-σ-below). Any
    change to §6 predicates or the chosen novel requires regenerating
    the manifest AND updating §3's inline numbers AND re-review.
    Regenerated manifest for the current revision was produced
    2026-04-21 on LXC; numbers in §3 match.
- **Code to commit before revision 9 run:**
  - Stratum-rate audit: `scripts/evals/preflight-arm-b-stratum-audit.ts`
    — new per revision 8/9's §3 gate. Queries historical `llm_calls`
    for the chosen source novel, computes overall + per-stratum fire
    rates, asserts overall ∈ `[0.24, 0.34]` SYMMETRIC, writes the
    audit result to `output/evals/arm-b-preflight-stratum-audit-<novel_id>.json`
    for the results memo to reference. The revision-9 audit has
    already been run ad-hoc and produced the manifest above; this
    script productionizes that ad-hoc query.
- **`tuning_experiment` ID will be:** assigned by
  `createTuningExperiment(type='preflight')` at charter GREEN.

## 10. Adversary review

Primary reviewer: Codex via `/charter-review` → `/codex:adversarial-review`.

This charter is narrower than `replay-ladder-v1` and directly
implements Codex's own cheapest-untried counterfactual from job
`aabc1fd419f0be2b2`. A fresh Codex pass is still required — the
named counterfactual was one paragraph; this charter adds stratum
rules, adjudication protocol, retest consistency check, parity span,
and GO/CAUTION/NO-GO thresholds that were not in the verdict text.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — round 1 | YELLOW | 2026-04-21 | Job `a768a8ffc489ea83d`. Shape accepted; five blockers on charter-level details: (1) Sample size vs band resolution — used 44.9% baseline fire rate but exp #254 SHIPPED V1 at 28.9%, so 10 beats → ~2.9 fires/arm, and a 10pt/15pt band at that N is label granularity not signal (§3.1). (2) Self-consistency rule internally inconsistent — §3 says "≥2/10 retests," §7 only creates 2 retests. Not a real reliability control (exp #258 lesson). (3) Strata predicates use `characters_present` but live schema is `beat.characters`; dialogue regex brittle; lore-match normalization undefined — violates §7.1. (4) Parity anchors "WORLD BIBLE section" / "BEAT CONTEXT section" don't exist in the live writer-request surface assembled from `beat-context.ts` + resolver output — §4.7 mask-too-much risk per exp #258. (5) `UNCLEAR => FP` asymmetrically biases the primary metric against Arm B — enriched context changes what counts as grounded, concentrating UNCLEAR on B. Warnings: 3-sample non-fire audit too thin for recall claim (keep descriptive only); "arm identity masked" overstated — call it hypothesis-masked; a NO-GO invalidates the bundled enrichment package per §11.5, not individual sub-blocks. All 5 blockers + 3 warnings addressed in revision 2. |
| `/codex:adversarial-review` (GPT) — round 2 | YELLOW | 2026-04-21 | Job `a74c1b24e966ef252`. Two residual blockers — all addressed in revision 3. (Verdict detail retained in commit `4b9ae65` message.) |
| `/codex:adversarial-review` (GPT) — round 3 | YELLOW | 2026-04-21 | Job `a233169484d5102a1`. Two residual blockers: (1) band-value inconsistency — §7 has 12.5/25pt bands but §1 says "within 10pt", §3 references "±10pt band" and "10–15pt band", §5 still says "enough for a 10pt band". A `-12.4pt` result is simultaneously GO (§7) and "not within 10pt" (§1). Fix: align every band reference to 12.5pt/25pt. (2) Parity underspecifies resolver replay — `buildBeatContext` takes `preResolvedRefs` as input (drafting.ts:282), so if Arm A re-runs `buildBeatContext` without archived `preResolvedRefs`, `resolveReferences()` may call LLM fallback (non-deterministic). Also §6 identifies refs section as "position-with-no-header" but `reference-resolver.ts:150` actually emits a `BACKGROUND:` header. Fix: archive + replay `preResolvedRefs` + `compactMode` + writer-pack inputs; identify refs section by `BACKGROUND:`; confirm system/model/provider/temperature/maxTokens/response_format are also checked per §4.7. Named counterfactual: offline archival parity dry-run + fire-prior audit (~$0). |
| `/codex:adversarial-review` (GPT) — round 4 | YELLOW | 2026-04-21 | Job `ac683bf10b86afc5c`. One residual blocker: §6 claimed `preResolvedRefs` was recoverable from `llm_calls.request_json`, but `requestEnvelopeForLog` (`src/llm.ts:197`) strips prompt fields before persistence — they go to `system_prompt` / `user_prompt` columns only. Fix: reframe Arm A as byte-replay of stored `user_prompt` bytes; Arm B constructs by inserting ENRICHED CONTEXT section into the recovered `sections[]`. Warning: `buildBeatContext` calls `getRelationshipBetween()` in non-compact mode (`beat-context.ts:286`) — moot under byte-replay since `buildBeatContext` is never re-executed. Named counterfactual: offline archival parity dry-run (~$0) — now adopted as a mandatory preflight-to-the-preflight in revision 5. |
| `/codex:adversarial-review` (GPT) — round 5 | YELLOW | 2026-04-21 | Job `ab8e849aa0e16739c`. Two residual blockers — both my own cleanup failures in revision 5: (1) §6 still contained leftover "import `buildBeatContext` and compare `_sections`" language from revision 4, contradicting the new byte-replay contract below. (2) Dry-run archived only "signature (headers + byte lengths + SHA-256)" but Arm B construction + byte-equality assertion require the full section strings. Also: 30% unrecoverable abort threshold is heuristic; Codex flagged that per §11.6 any non-trivial miss rate on a post-`sql/017` novel should be treated as schema-drift evidence, not averaged over. Codex explicitly confirms the byte-replay substrate is correct — blockers are cleanup, not structural. |
| `/codex:adversarial-review` (GPT) — round 6 | GREEN | 2026-04-21 | Job `a1bce27f1ac39e95b`. Revision 6 approved; executed as exp #260 with the charter-design flaw (floor-vs-cap incompatibility) undetected. Revision 7 supersedes. |
| execution outcome — exp #260 | INCONCLUSIVE | 2026-04-21 | See `docs/charters/arm-b-detector-preflight-results.md`. Two live-execution bugs fixed (commit `0ff8646`), infrastructure proven sound, but §3 adjudicable floor mathematically unreachable at §8 cap given V1 28.9% production fire rate. Revision 7 widens cap to 40 to restore floor/cap consistency. |
| `/codex:adversarial-review` (GPT) — round 7 | YELLOW | 2026-04-21 | Job `a3716aa364f4f2717`. Two blockers: (1) cap widen not propagated — preamble, §6 pool/stratum targets, §7 INCONCLUSIVE row still say "20 beats"; (2) floor-vs-cap invariant assumes IID Bernoulli at `p=0.289` but §6 deliberately stratifies toward higher-fire beats (dialogue/lore/state) — per `experiment-design-rules.md` §7.1/§11.6, distribution shift must be measured not assumed. Named counterfactual: pre-run stratum-rate audit on §6 predicates via `eval_cell_summary` (~$0, replaces IID guess with measured Poisson-binomial bounds). Fix: both. |
| `/codex:adversarial-review` (GPT) — round 8 | RED | 2026-04-21 | Job `ad26851206f1b345c`. Two blockers: (1) pool-policy contradiction — §3 "fall through to other strata" vs §6 "NOT reallocated, proceeds with smaller pool" are mutually exclusive, and the chosen novel's 2-beat dialogue stratum made this load-bearing; (2) eligibility gate asymmetry — "above band may still be used" permits cherry-picking high-fire novels for spurious GO verdicts. Named counterfactual: exact-pool feasibility audit (run in revision 9). Fix: both, plus drop dialogue-heavy target given audit findings. |
| `/codex:adversarial-review` (GPT) — round 9 | RED | 2026-04-21 | Job `a259fac690d09909a`. Two blockers: (1) stale revision-8 paragraph in §3 still says "dialogue target 16 of 40" + "fall through to other strata" + "smaller-than-target per-stratum fills" — directly contradicts revision 9's reallocate-to-none single policy. Same text-propagation failure class as round 7 blocker #1. (2) Detector-version confound — historical halluc-ungrounded labels in `llm_calls.response_content` may have been generated under a pre-V1 `BEAT_ENTITY_LIST_VARIANT`, but runtime now defaults to V1. §3 eligibility gate + §6 floor math both rely on historical labels without version-filtering. Named counterfactual: fresh detector re-audit on the fixed 40-beat manifest under frozen `BEAT_ENTITY_LIST_VARIANT=v1` (or filter historical rows by logged variant), ~$0.01, replaces version-confounded numbers with current-runtime bounds. Warnings: (a) minor numerical conflict (31.3% vs 30.8% in one row); (b) candidate table labels 31.7% as "above band" even though [0.24, 0.34] includes it (typo). **HOLDING revision 10 pending meta-consult** (job `a738b4bb2879c39d0`) on whether the whole measurement framework is the right instrument for the capital-allocation question; fixing these blockers may be moot depending on meta-consult outcome. |
| `experiment-adversary` (Opus) — fallback only | — | — | — |

Block run on YELLOW or RED. Iterate the charter, not the run. If
Codex RED's this preflight on a new axis, escalate — but note that
two RED verdicts in sequence (ladder + preflight) on the same
question family would indicate a deeper design problem worth a
synchronous pause rather than another revision round.
