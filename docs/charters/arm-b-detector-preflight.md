---
status: proposed
kind: experiment-charter
name: arm-b-detector-preflight
owner: andre
date: 2026-04-21
revision: 5 (post-Codex-YELLOW round 4 — 2026-04-21)
---

# Experiment Charter — `arm-b-detector-preflight`

Preflight for `replay-ladder-v1` (RED-blocked, commit `33a84f1`). One
question, two arms, **dynamic beat count** (≥8 adjudicated fires/arm or
20 beats cap), human-adjudicated. Named by Codex as the cheapest-untried
counterfactual in the ladder's charter review (job `aabc1fd419f0be2b2`).

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
20 per §3 dynamic stop rule) through two arms (A: baseline, B: +enriched
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
V1 baseline (28.9% fire rate): at that rate 10 beats → ~2.9 fires/arm,
20 beats → ~5.8 fires/arm. To resolve a 12.5pt / 25pt precision band
(one and two labels of drop at the 8-fire floor — see §7) we need ≥8
adjudicated fires per arm. That drives the dynamic stop rule below.

- **Dynamic stop rule** (replaces "10 beats fixed"): generate beats
  sequentially. After each beat, count cumulative adjudicable fires
  per arm (fires excluding UNCLEAR; see §7). Stop when either
  (a) both arms have ≥8 adjudicable fires, OR (b) 20 beats have been
  generated. Beats are generated in the pre-registered stratum order
  from §6, so sampling is still reproducible.
- **Detector precision on Arm B drops >25pt vs Arm A** (post-stop,
  computed per §7 formula — band calibrated to the 8-fire discretization
  floor: one label at that sample is 12.5pt, so >25pt = ≥2 labels of
  drop, unambiguous degradation). Detector generalizes poorly to the
  enriched-context distribution. KILL detector-as-primary-oracle on
  Arm B of the full ladder; revise `replay-ladder-v1` Arm B oracle
  to human adjudication primary, detector exploratory only.
- **Fewer than 8 adjudicable fires on either arm at the 20-beat cap.**
  Measurement too sparse for the 12.5pt / 25pt decision band even
  after budgeting. Abort; record as inconclusive; the right corrective is
  either a higher-fire-prior beat stratum (lore-heavy only) or a
  different detector, not more beats of the same stratification.
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
| Fixed 40-beat plan (no dynamic stop) | $1.50 + 3h | Overshoots: at 28.9% V1 fire rate, 40 beats → ~11.6 fires/arm expected. That would tighten the discretization step from 12.5pt (at 8 fires) to 8.3pt (at 12 fires), but charter bands are pre-registered at 12.5pt/25pt so the extra precision is not exploited — 2× the writer/adjudication budget for no decision-rule gain |
| Dynamic stop with minimum floor raised to 12 fires/arm | $2+ + 3h+ | At 28.9% fire rate, 12 fires/arm needs ~42 beats — blows the 20-beat cap and the wall-clock budget. Rejected in favor of widening decision bands to match the 8-fire discretization |

## 6. Distribution match

**Novel selection.** Same novel as `replay-ladder-v1` §6 would use —
most recent completed Salvatore-routed fantasy novel with ≥40 approved
beats. Fixing the novel here means the preflight's answer transfers
directly to the full ladder without re-selection confounds.

**Stratification** — executable rules against the live schema
(`src/schemas/shared.ts:38` `sceneBeatSchema` — fields `characters:
string[]`, `kind: "action" | "dialogue" | "interiority" | "description"`,
`description: string`). Used at both initial pool selection (up to 20
beats) and stop-rule termination.

Target composition when the stop rule triggers at 20 beats
(proportional scale-down at earlier stops — e.g., at 10 beats the
proportional target is 4/3/3):

- **Dialogue-heavy — 8 of 20 beats.** Primary predicate: `beat.kind ===
  "dialogue"` AND `beat.characters.length ≥ 3`. Fallback (ORed in) if
  primary set is under target: beats where the production prose
  contains ≥ 4 dialogue-tagged matches of the regex
  `/"[^"]{5,}"[\s\S]{0,30}?(said|asked|replied|whispered|shouted|muttered|called|answered)/gi`
  executed against the `llm_calls.response_content` of the approved
  beat-writer row. Regex is documented as a fallback heuristic, not a
  primary signal. Brittle-match disclaimer is acceptable for this role.
- **Lore-heavy — 6 of 20 beats.** `beat.description` contains a
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
- **State-leaning — 6 of 20 beats.** `chapter ≥ 3` AND
  `beat.description` matches the case-insensitive regex
  `/\b(remember(s|ed|ing)?|recall(s|ed|ing)?|know(s|n|ew)?|recogni[sz]e(s|d|ing)?|wonder(s|ed|ing)?\s+whether|already|still|again|(for|since)\s+(the|her|his|their)\s+(first|last))\b/i`.
  Pattern is checked into the runner script and committed before any
  generation.

**Deterministic selection.** For each stratum, query the set, order
ascending by `(chapter, beat_index)`, take the first N matching. If a
stratum returns fewer than its target (e.g., only 4 lore-heavy beats
exist), the deficit is NOT reallocated to another stratum — instead
the run proceeds with a smaller pool and the stop rule's 20-beat cap
still applies. If a stratum returns 0 matches, the preflight is
infeasible on this novel; switch novel selection (re-review required)
— do not silently relax the predicate.

**Parity harness** — tightened against the live assembly path in
`src/agents/writer/beat-context.ts:143-229`.

- **Script:** `scripts/evals/preflight-arm-b-parity.ts` (to create).
  Implements structured-segment diff per `experiment-design-rules.md`
  §4.7 extending the structure from
  `scripts/evals/conditioning-floor-parity-check.ts`.
- **Critical — operate on the pre-join `sections: string[]` array, NOT
  on the post-join user-prompt bytes.** `beat-context.ts:227` joins
  sections with `\n\n`, and in non-compact mode the CHARACTERS section
  at `beat-context.ts:195-199` contains internal `\n\n` delimiters via
  `snapshots.join("\n\n")`. A naive `userPrompt.split("\n\n")` cannot
  recover the original `sections[]`. The parity script therefore
  imports `buildBeatContext` directly and compares the returned
  `sections` array (exposed by adding an `_sections` debug field to
  the return value for the duration of the preflight; the existing
  `userPrompt` string remains the live production contract).
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
      4. Archive the recovered signature (sections[] headers + byte
         lengths + per-section SHA-256) to
         `scripts/evals/preflight-arm-b-parity-baseline.json`.

  Any beat whose row can't satisfy steps 2–4 is dropped from the
  pool. If more than 30% of the pool is unrecoverable, abort the
  preflight and re-select — the source novel is too old or too
  schema-drifted to support the contract. Do not proceed with
  a partial pool.
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
| **INCONCLUSIVE** | Checked FIRST. Fires on either arm < 8 at 20-beat cap, OR UNCLEAR rate > 25% on either arm (§3), OR ≥ 2/4 retest flips (§3). | Record inconclusive. Do NOT emit GO/CAUTION/NO-GO. Re-charter with higher-fire-prior stratum, different detector, or revised adjudication policy. |
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

Recalibrated in revision 2 against the 20-beat cap (not 10) and the
V1 production fire rate (28.9%, not 44.9% V0).

- **Spend cap:** $2 hard. Expected: 2 arms × up to 20 beats = ≤40 beat
  generations at Salvatore-v4 W&B Inference rates (~$0.02/call) =
  ~$0.80 writer spend + ~$0.05 incidental. The $2 cap leaves headroom
  for regeneration on transient infrastructure failures.
- **Wall-clock cap:** 3 hours from charter GREEN to result table
  committed. Writer generation ~30 min (sequential to respect W&B
  rate limits); parity harness ~10 min; adjudication pass up to
  2h (see below); writeup ~20 min.
- **Human-time cap:** 2 hours for adjudication. Expected load at
  8 fires/arm: 16 fire adjudications + 4 silent retests (re-use
  from the 16) + 6 non-fire audits (3 per arm) = 22 distinct packets
  at ~4–5 min each including the retest presentations. The 20-beat
  cap with fire rates at the production average gives at most
  ~12 adjudicable fires/arm, so the upper bound is ~30 distinct
  packets ≈ 2.5h — if that ceiling is hit, split across two sessions
  to preserve adjudicator reliability.
- **Stop if:** parity harness reports delta outside whitelisted span on
  any beat (§6 abort condition); either arm fails to reach 8
  adjudicable fires by the 20-beat cap (§3 INCONCLUSIVE);
  adjudicator self-disagrees on ≥2/4 retests (§3 retest kill);
  UNCLEAR rate >25% on either arm (§3 UNCLEAR abort); any beat
  generation errors on Arm A (baseline stability issue — bigger
  problem than this preflight).

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
- **Code that must be committed before run:**
  - Enriched-context builder module (feature-flagged, production-safe):
    `src/agents/writer/enriched-context.ts` (to create)
  - Preflight runner: `scripts/evals/run-arm-b-preflight.ts` (to create)
  - Parity harness: `scripts/evals/preflight-arm-b-parity.ts` (to create)
  - Adjudication helper: `scripts/evals/preflight-arm-b-adjudicate.ts`
    (emits blinded markdown pairs + retest shuffle)
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
| `/codex:adversarial-review` (GPT) — round 5 | — | — | (pending) |
| `experiment-adversary` (Opus) — fallback only | — | — | — |

Block run on YELLOW or RED. Iterate the charter, not the run. If
Codex RED's this preflight on a new axis, escalate — but note that
two RED verdicts in sequence (ladder + preflight) on the same
question family would indicate a deeper design problem worth a
synchronous pause rather than another revision round.
