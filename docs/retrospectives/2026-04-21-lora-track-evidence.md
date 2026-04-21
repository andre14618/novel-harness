---
status: draft (pending Arm D resolution)
kind: retrospective
topic: voice-LoRA-track-evidence
date: 2026-04-21
---

# 2026-04-21 Retrospective — Voice-LoRA Track Evidence

Written per Codex strategic consult (job `acc1b47d14ce265f4`). This
retrospective captures the 2026-04-21 experimental evidence on
Salvatore-voice-LoRA-adjacent levers and the strategic question it
raised: *should the voice-LoRA track be retired entirely in favor of
a capable-API-base + checker + unnamed-tone-methodology architecture?*

**Status: DRAFT — pending Arm D writer-upgrade verdict.** Per Codex
consult §3, the full synthesis (into `docs/decisions.md` +
`docs/lessons-learned.md` + potentially `docs/current-state.md`)
happens AFTER Arm D resolves, so this retrospective is not written
around an unresolved strategic question.

## Scope

This retrospective covers the arm-b-direct-pairwise charter arc
(including the 9-round `arm-b-detector-preflight` ancestor), the
parallel 2026-04-21 lever-killing signals, and the strategic-consult
response. It does NOT cover the LoRA-track history before 2026-04-21
(Salvatore v1-v5 training runs, Howard-primer methodology retirement,
conditioning-floor conception, etc.); those are either already in
`docs/voice-lora-salvatore.md` + `docs/decisions.md` or will be
added to this retrospective in the full-synthesis pass if needed.

## Timeline — 2026-04-21 signals on LoRA-adjacent levers

| # | Signal | Instrument | Outcome |
|---|--------|------------|---------|
| 1 | Conditioning-floor KILL | exp #258 charter | Sampling-parameter conditioning is NOT the lever for multi-character distinctness. See `docs/decisions.md` "Conditioning-floor KILL." |
| 2 | Rewrite-capability probe | exp #259 probe | Salvatore v4 LoRA cannot meaningfully rewrite from critique; it can only redraft from scratch. Output is V1-prose-anchored when V1 is in context. See `docs/decisions.md` "Rewrite capability probe." |
| 3 | Quality-redraft gate measurement | Novel PID 315593 | 0 detector fires across the run; the shipped redraft-gate never triggered. Detector thresholds likely too strict OR the novel sat below the mean fire rate. See `docs/decisions.md` 2026-04-21 "Quality-redraft gate" for the gate design + this outcome. |
| 4 | arm-b-direct-pairwise-v1 | N=20 blind human pairwise, exp (TBD — created by runner) | Salvatore v4 + enriched context lost 9-11 to Salvatore v4 + current context. CAUTION verdict. Enriched context is not a lever worth paying for on this corpus. See `docs/charters/arm-b-direct-pairwise-results.md`. |

**Pattern:** four negatives in a single day on four distinct
LoRA-adjacent levers. Not coincidence — consistent with the prior
"most Salvatore-adjacent micro-levers are already near-ceiling."

## The strategic question

User's proposal after #4:

> "should we just switch off the lora track and attempt to build out
> a rich generator with robust checks for continuity and rely on
> another methodology to handle tone, character, and dialogue quality?"

And later:

> "i think we should do a huge pass on fully documenting the entire
> line of experiments and pulling into lessons learned and explore
> using api models without fine tuning for the writer as an initial
> first step. we can use other methods to capture prose quality
> adjustments down the line maybe"

Claude's initial recommendation: don't pivot on this data alone; run
Arm D (writer-upgrade head-to-head with DeepSeek V3.2 base) first as
the forcing function.

## Codex strategic consult (job `acc1b47d14ce265f4`)

Codex identified that the user's proposal and Claude's recommendation
were both conflating three distinct claims:

| Claim | Evidence | Status |
|-------|----------|--------|
| "Current LoRA-side levers (conditioning, context, rewrite, redraft) are failing" | Strong — four 2026-04-21 signals | **Evidence supports** |
| "LoRA is empirically worse than a strong untuned base model" | None — never tested | **Unknown — Arm D answers** |
| "The whole fine-tune / offline thesis is wrong" | None | **Too large a claim** |

Codex endorsed running Arm D as the forcing function. Materially
agreed with Claude's recommendation. Added corrections:

1. **Unnamed alternative is load-bearing.** "We can use other methods
   later maybe" is acceptable for a bounded Arm D probe but NOT as
   basis for retiring the LoRA track. Howard-primer methodology was
   retired in 2026-04-16 for exactly the "prompt-based voice transfer
   doesn't work" reason; a pivot must name its tone/voice/character
   mechanism.

2. **Sequencing:** retrospective (this doc) + Arm D run in parallel;
   full synthesis AFTER Arm D resolves.

3. **Documentation home:** the 2026-04-21 experiment line belongs
   in a retrospective (this doc) — NOT in `lessons-learned.md`
   (reserved for distilled rules) NOR `decisions.md` (reserved for
   actual decisions) NOR `current-state.md` (reserved for the live
   architecture, only updated if architecture changes).

4. **Product-identity implication.** Dropping voice LoRA would
   change the harness's differentiator from "offline-capable voice
   imitation" (per `CLAUDE.md` "highest-impact fine-tune use case")
   to "planner/context/checker harness around an API writer." A real
   strategic choice. Arm D is the forcing function — but the product
   implication needs acknowledgment even if deferred.

## What we are NOT doing before Arm D resolves

- Retiring Salvatore v4 from production routes (`WRITER_GENRE_PACKS`
  in `src/models/roles.ts`).
- Committing new decisions to `docs/decisions.md` beyond the 4
  signals above.
- Distilling rules to `docs/lessons-learned.md`.
- Updating `docs/current-state.md` architectural claims.
- Killing the `salvatore-v5-corpus-expansion` charter.
- Starting Salvatore v5 work.
- Re-chartering additional LoRA-adjacent micro-levers.

What we ARE doing: this retrospective + the Arm D charter + run.

## What Arm D will tell us (pre-registered)

Per `docs/charters/arm-d-writer-upgrade.md` §3:

| Arm D outcome | Strategic implication |
|--------------|----------------------|
| DeepSeek wins ≥15 decisive | LoRA track empirically capped on prose quality. User's pivot justified. Trigger full synthesis + strategic-identity reckoning. |
| Salvatore wins ≥15 decisive | LoRA doing real work on prose quality. Keep the track. Redirect LoRA-adjacent micro-lever effort to corpus expansion / different fine-tune family / salvatore-v5. |
| CAUTION | Neither direction justified on prose quality alone. Strategic decision shifts to non-prose axes: cost per call, offline capability, voice specificity, corpus lock-in. |
| INCONCLUSIVE | Adjudicator reliability failed (retest flips or calibration); larger N or second adjudicator required before verdict. |

## Open questions for the full synthesis (post-Arm D)

1. If the pivot is justified (DeepSeek wins Arm D): what is the named
   tone/voice/character mechanism?

   **User's stated direction (2026-04-21, post-Codex-consult):**
   "exploring in the native API usage landscape with proper context
   and other techniques is more likely to be the way forward." This
   is the user beginning to name the alternative that Codex flagged
   as load-bearing — specifically:

   - **Native API writer** (no voice LoRA) as the base.
   - **Proper context** as the primary lever for quality — richer,
     better-targeted context assembly rather than weight-level voice
     imprinting.
   - **"Other techniques"** unnamed but implied: probably style-
     transfer post-passes, editing-pass workflows, or multi-stage
     generation (structure-from-base + surface-polish via a second
     call). Not yet specified.

   Other options floating in conversation:
   - Few-shot exemplars at prompt-time (this is what Howard primer
     tried and why it was retired — would need a novel approach)
   - Inference-time style-transfer post-pass (doesn't exist; would
     need to build)
   - Different fine-tune family targeted at the aspects LoRA couldn't
     reach (possible but re-opens the LoRA thesis with fresh scope)
   - Accept weaker voice distinctness as a product tradeoff

2. If the pivot is NOT justified (Salvatore wins Arm D): which
   LoRA-adjacent direction is the highest-EV next bet?
   - `salvatore-v5-corpus-expansion` (queued, deferred)
   - Different voice source corpus (not Salvatore)
   - Architectural change to how voice LoRA integrates with the
     writing pipeline (e.g., two-stage: base-model for structure, LoRA
     for surface-pass)

3. If CAUTION: what are the non-prose decision axes worth weighing,
   and what priors does the user hold on each?

## Process notes for future retrospectives

- The 9-round `arm-b-detector-preflight` → meta-consult-pivot →
  `arm-b-direct-pairwise` arc (documented in the preflight charter
  §10 + `docs/charters/arm-b-detector-preflight-results.md`) was
  itself a worth-capturing process lesson: "instrument discipline
  catches design contradictions and reproducibility gaps, but does
  not catch driver-level type surprises" (which live-execution
  surfaced via the request_json-as-TEXT and JSONB-as-string bugs
  fixed in commit `0ff8646`). This process observation will get a
  lessons-learned entry AFTER the Arm D arc completes.

- The pattern of Codex step-back / meta-consults preventing
  review-tower waste (the preflight arc was going to hit round 10+
  before the pivot consult redirected it) is worth documenting as a
  repeatable tool. Candidate rule for `lessons-learned.md`: "after
  N ≥ 3 rounds of increasingly-fine-grained adversarial review on a
  single charter, step back and meta-consult the framework before
  writing another revision."

## Pointers

- Parent charter: `docs/charters/arm-b-direct-pairwise.md` (revision 2)
- Results memo: `docs/charters/arm-b-direct-pairwise-results.md`
- Forcing function: `docs/charters/arm-d-writer-upgrade.md`
- Meta-consult: job `acc1b47d14ce265f4` (this doc's origin)
- Preflight ancestor: `docs/charters/arm-b-detector-preflight.md`
  + `docs/charters/arm-b-detector-preflight-results.md`
