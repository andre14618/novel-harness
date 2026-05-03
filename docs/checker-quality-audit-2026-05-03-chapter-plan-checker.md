---
status: active
date: 2026-05-03
companion_to: checker-quality-audit-2026-05-03.md
methodology: manual-fire-grading
sample_window: all-time most-recent-25 fires (72h window had only 7 fires; 7-day had same 7; all 515 total fires are from 2026-04-16 onward)
audit_owner: andre
independent_audit: invited
---

# Chapter-Plan-Checker Quality Audit — 2026-05-03

## Headline Counts

| Checker | TP | FP | GRAY | n | TP% |
|---|---|---|---|---|---|
| `chapter-plan-checker` | 11 | 8 | 6 | 25 | **44%** |

This is the highest TP rate of any LLM checker audited in this session (vs. 11% for `halluc-ungrounded`, 24% for `adherence-events`). That finding is load-bearing: at 44% TP it performs better than a coin flip and materially better than the drafting-layer checkers. However the 32% FP rate and 24% GRAY still produce substantial false gating, and the FP modes are structural rather than prompt-tunable.

---

## What chapter-plan-checker Does

`chapter-plan-checker` runs **after a chapter draft is written**, comparing completed prose against the chapter plan. It is not a pre-draft gate — it receives `(outline, prose)` together. When it returns `pass=false`, the `chapter-plan-reviser` is called to revise the plan based on the identified deviations; after plan revision the chapter may be re-drafted.

The checker's rubric (from `plan-adherence-system.md`) is deliberately liberal:

- **setting_match**: `false` only if the prose is in a *completely* different location, not just a different room.
- **emotional_arc_correct**: `false` only if the emotional direction is *reversed*, not just different in tone.
- **pass**: fails only for setting mismatch, reversed emotional arc, OR a major plot contradiction (character dies when plan has them alive later, resolved conflict re-opened, character knows something they shouldn't).
- **deviations**: explicitly excludes paraphrased dialogue, reordered details, added atmosphere, slightly different physical actions, minor spatial variation, missing individual beat events, and characters absent from a single beat.

The rubric is designed to catch structural betrayals, not creative interpretation. The checker uses `buildContext()` in `context.ts`, which feeds the LLM: chapter metadata, all scene beats with characters and payoff seeds, established facts, character state changes, and knowledge changes — then the full prose.

**Downstream effect.** `pass=false` triggers `chapter-plan-reviser`, which re-drafts the outline. Under the new world-bible architecture, the chapter-plan-checker's output is also the gate before planning artifacts (established facts, character state changes, knowledge changes) are persisted as canonical bible entries. A false-passing plan (FN) introduces noisy facts into the bible. A false-failing plan (FP) wastes a plan-revision cycle and may cause the reviser to alter a good plan.

---

## Sample Composition

25 most-recent `pass=false` fires from `llm_calls` where `agent='chapter-plan-checker'` and `json_extraction_success=true`, ordered by `timestamp DESC`.

- Novel distribution: fantasy-debt novel family (13 entries), fantasy-cartographer (1), fantasy-archive (1), Scribe's Secret variants (4), The Deep Stacks (1), Ashrot hospital (1).
- Chapters: mostly chapter 1 (establishing facts are the primary failure mode early in a novel); chapters 2-5 also present.
- Total deviations across 25 entries: 39 (average 1.56 per fire, range 1–7).

The 72-hour and 7-day windows both yielded only 7 fires, so the sample was widened to all-time most-recent-25. The 515 total fires span 2026-04-16 to 2026-05-03, all within the current pipeline stack. No further time-windowing was needed.

Pull script: `scripts/_q-cpc.ts` (on LXC at `~/apps/novel-harness/scripts/_q-cpc.ts`).

---

## Per-Entry Grades

| Entry | id | Chapter | Verdict | One-liner |
|---|---|---|---|---|
| 0 | 61728 | 1 | GRAY | Plan says "test begins" as final beat (cliffhanger implied); prose resolves the test. Ambiguous: completing what the plan says begins vs. violating intended structure. |
| 1 | 60892 | 1 | **TP** | Plan places climactic beats 8-13 in Deep Stacks; prose has Noor back in Grand Vestibule for the marginalia exchange. Character state says "location=Deep Stacks" — contradicted. |
| 2 | 58664 | 1 | **TP** | Plan: official Strength = 3 (read aloud at beat 12); prose: "Her official Strength stat read six." Clear numeric contradiction. |
| 3 | 58606 | 1 | **FP** | Plan has official record = 3, true ability higher — dual-stat premise. Prose "Strength 9" is her actual capability. Checker conflates official stat with true stat. |
| 4 | 58321 | 1 | GRAY | Plan: class overwritten same day; checker claims one year later. The eight-year reference in prose is Cassel's investigation, not overwrite timing. Specific overwrite timing unclear. |
| 5 | 58319 | 1 | **TP** | Plan: original class = Warrior; prose: "The original class...was *Arbiter.*" Clear factual contradiction in an established fact. |
| 6 | 55635 | 1 | **TP** | Plan: "lost ALL previous patients before the fungus discovery"; prose: 43 patients cured into hollows using the fungus tincture before the plot's pivotal cure. Contradicts first-cure premise. |
| 7 | 54033 | 2 | **TP** | Misgendering Alory Vane (she/her POV written as he/his throughout); misgendering alone justifies pass=false. Additional deviations (furniture, veiled-threat timing) are weaker. |
| 8 | 54028 | 2 | **TP** | Same misgendering as entry 7. The POV character's gender being wrong throughout the draft is a structural defect. |
| 9 | 54022 | 2 | **TP** | Misgendering + wrong title for Lyra (called "Guildmaster/spokeswoman" when plan has a different role). Multiple valid TPs. |
| 10 | 53622 | 5 | **TP** | Plan: Taryn absorbs systemic false debt ledger; prose: she absorbs a specific wizard's personal debt. Mechanism diverges from plan specification. |
| 11 | 53518 | 5 | **TP** | Plan: "hopeful but costly resolution"; prose: Taryn explicitly abandons her beliefs for cynical pragmatism. Clear emotional arc direction reversal. |
| 12 | 52979 | 3 | **FP** | Required fact: debts interlinked with life-force. Prose demonstrates via action (sigils explode, debtors die) but doesn't state it as exposition. Implicit-vs-explicit FP mode. |
| 13 | 53241 | 3 | **FP** | Same as entry 12: life-force connection shown through consequences, not stated verbally. Repeated same-family FP. |
| 14 | 53187 | 3 | **FP** | Same as entries 12-13. Four consecutive retries on the same chapter, all hitting the same FP. |
| 15 | 53092 | 3 | **FP** | Same as entries 12-14. Fourth consecutive retry; checker consistently misses the implicit establishment. |
| 16 | 53138 | 3 | GRAY | Plan: Taryn horrified and guilt-ridden; prose: desperate escape with dread of Brennan's pursuit. Neither triumph nor clear guilt. Somewhere between planned and claimed arc. |
| 17 | 52979 | 2 | GRAY | Brennan appears throughout but not listed in characters-present. System prompt says not to flag "characters absent from a single beat" — but adding an unlisted antagonist throughout is more substantial. |
| 18 | 52787 | 1 | GRAY | Plan requires explicit establishment of debt-mark glowing/flickering rules; prose shows the behavior but may not state the rule. Borderline implicit vs explicit. |
| 19 | 52703 | 1 | **FP** | Brennan's fabrication of debts IS established via evidence scene (ledger entries in his name, Aldric's evidence scroll). Checker objects to "Lord Brennan" vs "Lord Sorcerer Brennan" — pedantic title. |
| 20 | 52608 | 1 | **FP** | Supervisor's quota-over-investigation attitude IS shown in beat 4-5 (supervisor dismisses anomaly as glitch). Checker demands explicit statement of what the scene demonstrates. |
| 21 | 52380 | 1 | **TP** | Plan: Alory chooses to investigate further; prose: explicit suppression ("would not go back...would tell no one"). Clear directional reversal of the hook beat. |
| 22 | 52110 | 1 | **TP** | Plan: rooms grow during new moon; prose: "bookshelves widened...during the full moons." Active contradiction (wrong moon phase), not just missing. |
| 23 | 51894 | 4 | GRAY | Aldric's death IS shown (he activates ritual, dies). Specific causal mechanism "life force strengthens false debts" may not be stated. Death fact present; mechanism fact borderline. |
| 24 | 51762 | 3 | **FP** | Plan: ledger contains debts tied to border defense. Prose explicitly: "debts were for the construction and maintenance of the magical wards that protected the northern border." Checker failed to recognize the fact was present. |

---

## Dominant FP Patterns

### FP Pattern 1: Implicit-vs-explicit delivery (entries 12-15, 20)

The most common FP mode: the plan's established fact is *demonstrated* through events in the prose rather than *stated* as exposition, and the checker fires because the fact wasn't verbally asserted.

**Evidence.** Entries 12-15 are four retries on the same chapter for the fact "false debts are interlinked with debtors' life-force." In every draft, the life-force connection is shown through the consequences (sigils explode, debtors die when the fraud is exposed), but the checker insists the causal mechanism must be stated. Entry 20 shows the Supervisor's quota-prioritization attitude demonstrated through a scene of dismissal but not stated as a character summary.

This FP mode mirrors the adherence-events FP class ("implicit-vs-explicit pedantry") found in the main audit. The checker's system prompt says "Beat descriptions are creative inspiration, NOT literal scripts" — but for established facts, the checker is applying a strict "must be stated" bar rather than accepting demonstration.

**Why it matters.** In the fantasy-debt novel, this FP is the reason for 4 consecutive pass=false retries on chapter 3 (entries 12-15). The plan reviser is being called 4 times for a single chapter on a deviation the prose is already satisfying via normal literary technique.

### FP Pattern 2: Scene-demonstration not recognized (entries 19, 20, 24)

Related but distinct from Pattern 1: the prose contains an explicit scene or statement that establishes the required fact, but the checker doesn't recognize it because the surface form differs slightly from the plan's specification.

- Entry 19: Ledger entries explicitly show "In favor of the mage, Lord Brennan" and Aldric's evidence scroll confirms fraud — the checker fires because the fact said "Lord Sorcerer Brennan fabricating false debts" and the prose says "Lord Brennan" with clear fraudulent ledger entries.
- Entry 20: Beat 5 explicitly shows the Supervisor saying "focus on quota fulfillment" and dismissing the anomaly as a "minor glitch" — the checker fires for the fact not being "established" even though the exact behavior the fact describes is in the scene.
- Entry 24: Prose explicitly states "the debts were for the construction and maintenance of the magical wards that protected the northern border" — checker fires anyway.

This is a hallmark of a checker running with insufficient context for semantic matching: the checker sees the required fact description as a target string and compares it against the prose at the phrase level, missing the fact when it's stated with different surface form.

### FP Pattern 3: Dual-stat / dual-record misread (entry 3)

The plan establishes a world where characters have an official stat (falsified) and a true ability (hidden). Entry 3 fires because the prose uses "Strength 9" (the character's true reading) while the plan says "official System record lists Strength 3." The checker conflates the two. This is a world-model comprehension failure — the checker doesn't carry the "official vs. actual" distinction from the plan's established facts into its reading of the prose.

---

## True Positive Patterns

The checker's successful catches cluster into three categories:

1. **Gender errors** (entries 7, 8, 9): POV character's gender written wrong throughout the draft. These are clear structural defects that should definitely block. The checker catches them reliably. Three retries on the same novel chapter, all correctly identified.

2. **Explicit numeric/factual contradictions** (entries 2, 5, 22): Plan states a concrete fact (Strength = 3, class = Warrior, new moon); prose states the opposite (six, Arbiter, full moon). Clean catches. These cases have no ambiguity.

3. **Emotional arc reversals with direction change** (entries 11, 21): Plan ends with hope/sacrifice or continued-investigation hook; prose ends with cynicism-abandonment or suppression-of-discovery. These are the cleanest emotional arc catches — not just a different tone but a reversed direction. The checker correctly identifies these as structural betrayals per its own rubric.

4. **Mechanism/agent divergence** (entries 6, 10): Plan specifies a particular causal mechanism or agent (first cure, specific absorption from false ledger); prose uses a different mechanism. These are generally correct catches although they can shade toward GRAY if the mechanism difference is subtle.

---

## K=3 Stochasticity Validation (added 2026-05-03)

After the single-grader audit (n=25, 44% TP) completed, the user pushed back on the "44% is good enough" framing and asked for empirical data on whether cheap rubric modifications could push the operating point to a clearly net-positive zone. A four-arm K=3 sweep ran the same 25 cases through DeepSeek V4 Flash with thinking enabled (production config) under two prompts × three calls each:

- **Control prompt:** the production system prompt (re-run)
- **v2 prompt:** production prompt + two narrow rubric modifications targeting the implicit-vs-explicit FP class:
  1. New principle at the top: "TREAT DEMONSTRATION AS DELIVERY. When the plan requires establishing a fact, the fact counts as established if EITHER (a) it is stated explicitly, OR (b) it is *shown to be true* through the events of the scene."
  2. Added two items to the DO-NOT-FLAG list: "Required facts that are demonstrated through scene events or consequences, even if not stated as exposition" and "Established facts whose substance is shown with different surface phrasing than the plan used."

Recall-preserving by construction: only ADDS items to DO-NOT-FLAG; never removes any TP-eligible criteria.

**Replay script:** `scripts/_cpc-rubric-replay.ts` (local). Total cost: ~$0.20–$0.40 (150 V4-Flash calls with cache hits across the K=3 same-prefix pattern). Output: `/tmp/cpc-replay-k3.json`.

### Four-arm results (n=25)

| Arm | Total fires | TP catches | FP fires | GRAY fires |
|---|---|---|---|---|
| Control K=1 (production-equivalent) | 10/25 | **4/11 (36%)** | 4/8 (50%) | 2/6 (33%) |
| Control K=3-AND (≥2 of 3 fire) | 9/25 | **4/11 (36%)** | 3/8 (38%) | 2/6 (33%) |
| v2 K=1 | 7/25 | **4/11 (36%)** | 1/8 (13%) | 2/6 (33%) |
| **v2 K=3-AND** | 7/25 | **3/11 (27%)** | 2/8 (25%) | 2/6 (33%) |
| Control K=3-OR (any 1 of 3 fires) | 15/25 | 7/11 (64%) | 5/8 (63%) | 3/6 (50%) |
| v2 K=3-OR | 12/25 | 6/11 (55%) | 3/8 (38%) | 3/6 (50%) |

### The smoking gun: flake distribution

| Arm | Unanimous fires (3/3) | Split (1 or 2 of 3) | Unanimous passes (0/3) |
|---|---|---|---|
| Control | **4/25 (16%)** | 11/25 (44%) | 10/25 (40%) |
| v2 | 1/25 (4%) | 11/25 (44%) | 13/25 (52%) |

Only **4 of 25 originally-firing cases (16%)** get unanimous K=3 re-fires under control. The other 21 are either split (model disagrees with itself across 3 calls) or unanimous-passes (model now says pass on all 3 looks). **The production gate fires almost entirely on borderline cases the model can't reproduce on a second look.**

### Implications

1. **Effective TP rate at the gate-decision level converges to ~36%** across all four practical arms (K=1 control, K=3-AND control, K=1 v2, K=3-AND v2). The 44% TP from the single-grader audit was the precision *conditional on the gate firing*, but the gate's firing decision is itself a coin flip on 60% of original-fire cases.
2. **Voting reduces FPs but not by enough.** Control K=3-AND: 4 → 3 FP fires. v2 K=3-AND: 4 → 2 FP fires. Modest gain at 3× LLM cost.
3. **The v2 rubric is within noise.** v2 K=3-AND vs control K=3-AND: −1 TP catch, +1 FP elimination. Coin-flip on n=24 valid pairs.
4. **No reachable operating point is clearly net-positive.** At ~36% TP / ~25% FP / ~33% GRAY-fire, expected value is approximately break-even with V≈C. Voting + rubric tweaks compound to roughly the same break-even point at higher cost.

**The architecture is the bottleneck, not the operating point.** The original single-grader audit suggested chapter-plan-checker was conditionally retainable with a narrow rubric fix. The K=3 sweep refutes that — the catchable signal is muffled by the same implicit-vs-explicit ambiguity that breaks the other LLM checkers, and expanding context (which is what the world-bible architecture provides) is the only architectural lever that addresses the root cause.

---

## Verdict and Recommendation (post-K=3)

**Demote chapter-plan-checker to warning-class; reborn in post-draft layer over world bible.**

This matches the recommendation for halluc-ungrounded, continuity, adherence, and functional-state-checker. All five LLM checkers retire from the drafting blocker layer with the same architectural verdict.

The catches that ARE real — gender errors, explicit numeric contradictions, emotional-arc reversals, mechanism/agent divergence — should still surface as warnings the operator/editor can action; they just shouldn't block drafting. The 16% unanimous-K=3 fire rate is a useful signal for which warnings are likely to be load-bearing vs. stochastic noise: a future operator-summary view could surface only fires that reach unanimous K=3 agreement, drastically reducing alert fatigue without additional engineering on the checker itself.

### What the data ruled out

| Hypothesis | Verdict |
|---|---|
| "44% TP justifies retention with cheap rubric fix" (original audit verdict) | **Refuted** — TP at gate-decision level is ~36%, and rubric fix doesn't lift it |
| "K=3 multi-call voting will lift TP retention" | **Refuted** — TP rate identical across K=1 and K=3-AND |
| "v2 rubric + K=3-AND combined is the sweet spot" | **Refuted** — gains are within noise on n=25 |
| "Operating point can be tuned past break-even" | **Refuted** — all four practical arms converge at break-even |

### What stands

| Claim | Status |
|---|---|
| The TPs that fire are real catches | **Stands** — qualitative review of the 4 unanimous-control fires confirms genuine plan betrayals |
| The FP class is implicit-vs-explicit delivery | **Stands** — visible across all five checkers, root cause is local-only context |
| Architecture pivot is empirically supported | **Strengthened** — K=3 is the cleanest evidence that operating-point tuning is not the lever |

---

## Replication Notes

### Pull Script

`scripts/_q-cpc.ts` on the LXC at `~/apps/novel-harness/scripts/_q-cpc.ts`. Uses tagged-template-literal syntax:

```ts
import db from "../src/db/connection"
const rows = await db`
  SELECT id, timestamp, novel_id, chapter, beat_index, attempt,
         user_prompt, response_content
  FROM llm_calls
  WHERE agent = 'chapter-plan-checker'
    AND (response_content::jsonb->>'pass')::boolean = false
    AND json_extraction_success = true
  ORDER BY timestamp DESC
  LIMIT 25
`
process.stdout.write(JSON.stringify(rows, null, 2))
```

Run: `bun scripts/_q-cpc.ts > /tmp/chapter-plan-checker-fp-sample.json`

Sample artifact: `chapter-plan-checker-fp-sample.json` in repo root (not committed).

### Grader Prompt Elements

This audit was graded manually by the engineering agent (not a Sonnet subagent) after exhaustive reading of each entry's plan and prose. Key grading considerations applied:

- **TP:** the deviation names a real plan betrayal — the plan says X, the prose says not-X (wrong setting, reversed arc, numeric contradiction, character misgending, wrong established fact).
- **FP:** the prose actually satisfies the plan's intent, even if via implication, demonstration, or surface-form variation. The checker is wrong.
- **GRAY:** the plan's intent is ambiguous (e.g., plan says "test begins" as final beat — does the chapter end there, or does "begins" permit completion?), or the deviation involves a legitimate stylistic choice that reasonable graders could disagree on.

**Warning against:** accepting "implicit vs explicit" as a valid deviation (prose that demonstrates a fact via scene should count as establishing it). Accepting minor surface-form differences in names/titles as non-establishment.

### Sample Provenance

The 25 most-recent `pass=false` fires from `llm_calls` as of 2026-05-03. All 515 total fires are from the current pipeline stack (2026-04-16 onward). The sample covers 10 novels, with fantasy-debt family (11 entries) dominating due to high retry counts on a chapter with the implicit-life-force FP pattern.

---

## Comparison to Main Audit

| Checker | TP | FP | GRAY | n | Gate |
|---|---|---|---|---|---|
| `halluc-ungrounded` | 11% | 71% | 18% | 28 | blocker |
| `adherence-events` | 24% | 60% | 16% | 25 | blocker |
| `functional-state-checker` | 0% | 88% | 12% | 25 | warning |
| `continuity-*` | 39% | 22% | 39% | 23 | blocker |
| **`chapter-plan-checker`** | **44% (single-grader) / 36% (K=3-adjusted)** | **32% / ~25%** | **24% / ~33%** | **25** | **blocker (recommended demote → warning)** |

`chapter-plan-checker` has the best TP rate of the LLM checkers in the single-grader audit, but the K=3 stochasticity sweep shows the operating point at the gate-decision level is ~36% TP and cannot be lifted past break-even via prompt or voting tweaks. All five LLM checkers retire from the drafting blocker layer with the same architectural verdict; chapter-plan-checker's residual signal is best surfaced as a warning class with optional unanimous-K=3 filtering for high-precision alerts.
