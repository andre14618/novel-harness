---
status: proposed
kind: experiment-charter
name: arm-b-detector-preflight
owner: andre
date: 2026-04-21
revision: 1
---

# Experiment Charter — `arm-b-detector-preflight`

Preflight for `replay-ladder-v1` (RED-blocked, commit `33a84f1`). One
question, two arms, ten beats, human-adjudicated. Named by Codex as the
cheapest-untried counterfactual in the ladder's charter review (job
`aabc1fd419f0be2b2`).

## 1. Question

Does the `halluc-ungrounded` detector — calibrated against current
production context per exp #254 (`beat-entity-list-v1`) — remain usable
as a primary oracle on prose generated under a **new context
distribution** (enriched context: `speaker_directives` + reader-info
state slice + targeted world-bible expansion keyed to beat entities)?

Restated as a falsifiable concrete: is detector precision on Arm B
prose within 10pt of detector precision on Arm A prose?

Per `experiment-design-rules.md` §3.2 / §9.2 / §11.6, a production-
calibrated detector is a provisional instrument when the input
distribution changes. The full `replay-ladder-v1` charter assumed the
detector stays usable across Arms A/B/C/D; Codex adversarial flagged
this as an unvalidated assumption (Blocker #2, 2026-04-21). This
preflight resolves the assumption directly before committing to the
full ladder.

## 2. Hypothesis

**If** we generate 10 stratified beats through two arms (A: baseline,
B: +enriched context) and adjudicate every `halluc-ungrounded` detector
fire on each arm against a shared human-labeled ground-truth (TP / FP /
TN / FN), **then** detector precision on Arm B will be within 10pt of
detector precision on Arm A, **because** the enriched-context block
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

Stated before results:

- **Detector precision on Arm B drops ≥15pt vs Arm A.** The detector
  generalizes poorly to the enriched-context distribution. KILL the
  detector-as-primary-oracle approach for `replay-ladder-v1` Arm B.
  Revise the full ladder charter to use human adjudication as the
  primary oracle on Arm B, with detector outputs as exploratory only.
- **Detector emits fewer than 4 fires total across both arms and 10
  beats.** Measurement is too sparse to draw any precision conclusion
  (would leave 1–3 fires per cell). Abort the preflight. Re-seed beat
  selection toward higher-prior-fire beats (e.g., lore-heavy stratum
  exclusively) and re-run at 10 beats; if still <4 fires, detector is
  too quiet on this novel to be the right oracle at this scale
  regardless of context.
- **Human adjudicator self-disagrees on ≥2/10 repeated adjudications
  (built-in 20% retest on randomized sample).** Adjudicator reliability
  is insufficient; the ground-truth itself is noisy. KILL this
  preflight; do not report a precision number derived from
  unreliable labels. Escalate to a calibration workshop or a second
  adjudicator before any future preflight.

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
| 20 beats instead of 10 | $1 + 90min | Diminishing returns on precision estimate at this N; 10 beats × expected ~45% fire rate gives ~9 fires/arm, enough for a 10pt precision band |

## 6. Distribution match

**Novel selection.** Same novel as `replay-ladder-v1` §6 would use —
most recent completed Salvatore-routed fantasy novel with ≥40 approved
beats. Fixing the novel here means the preflight's answer transfers
directly to the full ladder without re-selection confounds.

**10-beat stratification** — executable rules (pre-commit before
generation):

- 4 dialogue-heavy beats: `characters_present` array length ≥ 3 AND beat
  contains ≥ 4 dialogue-tagged sentences (regex `/"[^"]+"\s+(said|asked|
  replied|whispered|shouted)/gi` count ≥ 4 on prod prose)
- 3 lore-heavy beats: `beat.description` mentions ≥ 1 entity where
  `entity` exists in `world_bible.locations ∪ cultures ∪ systems` AND
  the entity does NOT appear in any prior beat's prose in the current
  chapter
- 3 state-leaning beats: beat is chapter ≥ 3 AND
  `beat.description.toLowerCase()` contains any of: `remembers`,
  `recalls`, `knows`, `recognizes`, `already`, `still`, `again`,
  `wonders whether`

Selection within each stratum is deterministic: query the set, order
by `(chapter, beat_index)` ascending, take the first N matching.
`rebase-if-empty` logic only applies if a stratum returns 0 matches
from the source novel — fallback is to either switch novels (fail the
preflight if no qualifying novel) or expand the strata definitions at
charter revision time (re-review required).

**Parity harness.** Arm A byte-matches production beat-writer row for
the same (novel, chapter, beat) tuple modulo timestamp. Arm B adds
the enriched-context block as the single named expected-delta span.
Concrete contract:

- **Script:** `scripts/evals/preflight-arm-b-parity.ts` (to create)
- **Expected delta span:** exactly one block between the WORLD BIBLE
  section and the BEAT CONTEXT section, labeled `ENRICHED CONTEXT:`,
  containing three named sub-blocks: `SPEAKER DIRECTIVES`,
  `READER-INFO STATE`, `FOCUSED WORLD SLICE`. No other byte differs.
- **Abort condition:** any delta outside the `ENRICHED CONTEXT:` block
  fails parity for that beat; log and abort the preflight. Do not
  silently re-emit.

## 7. Success criteria

**Oracle: human adjudication.** Every `halluc-ungrounded` fire on
either arm gets adjudicated against the prose (Sonnet-generated
context + prose visible to the adjudicator, with arm identity masked).
Adjudicator labels: TP (the entity is genuinely ungrounded given the
full context the writer saw), FP (the entity is grounded but the
detector missed it), UNCLEAR (rare — document why, counts as FP for
the metric).

Plus a **sampled non-fire audit**: 3 random non-fire beats per arm
get adjudicated for FN (the detector missed a real ungrounded
entity). Gives a coarse recall floor.

**Adjudicator self-consistency check**: 2 fires are randomly selected
and silently re-presented at the end of the adjudication pass
(position-shuffled, arm-masked). If adjudicator flips on either, treat
as a §3 bullet 3 falsification.

**Primary metric — precision per arm:**

`precision_arm = TP / (TP + FP)` computed across the 10 beats of that arm.

| Outcome | Condition | Action |
|---------|-----------|--------|
| GO | `precision_B ≥ precision_A − 10pt` AND both arms have ≥ 4 fires | Proceed to revise `replay-ladder-v1` with detector as primary oracle on Arm B (retain other blockers' fixes) |
| CAUTION | `precision_A − 15pt ≤ precision_B < precision_A − 10pt` | Proceed to full ladder but downgrade Arm B detector evidence to secondary; add a 10-beat human sidecar on Arm B specifically for prose-quality check |
| NO-GO | `precision_B < precision_A − 15pt` | Per §3 bullet 1: detector-as-primary-oracle is not viable on Arm B. Redesign `replay-ladder-v1` Arm B oracle to human-adjudication primary |

**Secondary observations (report but do not gate on):**
- Fire-rate delta `(fires_B - fires_A) / 10` — directional signal on whether context engineering is reducing flags
- Sampled FN count per arm — coarse recall comparison
- Stratum breakdown — does precision shift differentially on dialogue vs lore vs state beats?

## 8. Budget

- **Spend cap:** $1 hard. Expected: ~$0.15 writer calls (20 beat
  generations at DeepSeek V3.2-equivalent rates for Salvatore v4) +
  ~$0.05 incidental = $0.20 real spend.
- **Wall-clock cap:** 2 hours from charter GREEN to result table
  committed.
- **Human-time cap:** 90 minutes for adjudication pass (20–25 fire
  adjudications + 6 non-fire audits + 2 retest-consistency checks).
- **Stop if:** parity harness reports delta outside whitelisted span on
  any beat (§6); total fires <4 across both arms (§3 bullet 2);
  adjudicator self-disagrees on ≥2 retests (§3 bullet 3); any beat
  generation errors on Arm A (baseline stability issue, bigger problem
  than this preflight).

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
| `/codex:adversarial-review` (GPT) — primary | YELLOW | 2026-04-21 | Job `a768a8ffc489ea83d`. Shape accepted; five blockers on charter-level details: (1) Sample size vs band resolution — used 44.9% baseline fire rate but exp #254 SHIPPED V1 at 28.9%, so 10 beats → ~2.9 fires/arm, and a 10pt/15pt band at that N is label granularity not signal (§3.1). (2) Self-consistency rule internally inconsistent — §3 says "≥2/10 retests," §7 only creates 2 retests. Not a real reliability control (exp #258 lesson). (3) Strata predicates use `characters_present` but live schema is `beat.characters`; dialogue regex brittle; lore-match normalization undefined — violates §7.1. (4) Parity anchors "WORLD BIBLE section" / "BEAT CONTEXT section" don't exist in the live writer-request surface assembled from `beat-context.ts` + resolver output — §4.7 mask-too-much risk per exp #258. (5) `UNCLEAR => FP` asymmetrically biases the primary metric against Arm B — enriched context changes what counts as grounded, concentrating UNCLEAR on B. Warnings: 3-sample non-fire audit too thin for recall claim (keep descriptive only); "arm identity masked" overstated — call it hypothesis-masked; a NO-GO invalidates the bundled enrichment package per §11.5, not individual sub-blocks. Named counterfactual: same preflight but "run until ≥8 adjudicated fires per arm or 20 beats max" + fix retest denominator + neutral UNCLEAR policy; ~$1 + 2–3h. Recommendation: REVISE CHARTER. |
| `experiment-adversary` (Opus) — fallback only | — | — | — |

Block run on YELLOW or RED. Iterate the charter, not the run. If
Codex RED's this preflight on a new axis, escalate — but note that
two RED verdicts in sequence (ladder + preflight) on the same
question family would indicate a deeper design problem worth a
synchronous pause rather than another revision round.
