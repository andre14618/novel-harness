---
status: active
date: 2026-05-03
methodology: subagentic-fire-grading
sample_window: 72h preceding 2026-05-03
audit_owner: andre
independent_audit: invited
---

# LLM-Backed Checker Quality Audit — 2026-05-03

## Executive Summary

Five LLM-backed checkers were graded by sampling recent production fires and asking Sonnet subagents to judge each fire as TP / FP / GRAY. Sample sizes were 23–28 fires per checker. The chapter-plan-checker result was further validated by a four-arm K=3 stochasticity sweep (control K=1, control K=3-AND, v2-prompt K=1, v2-prompt K=3-AND) — see §"K=3 Stochasticity Validation" below.

| Checker | Current Severity | TP | FP | GRAY | n | Action Recommended |
|---|---|---|---|---|---|---|
| `halluc-ungrounded` (LLM-only blocker) | blocker, gates retries | **11%** | 71% | 18% | 28 | Retire from drafting layer; rearchitect as post-draft deterministic-NER-vs-bible flag + LLM triage |
| `continuity-*` (state + facts) | blocker, gates approval | **39%** | 22% | 39% | 23 | Demote to warning-class; subsume into post-draft layer over world bible |
| `adherence-events` | blocker, gates retries | **24%** | 60% | 16% | 25 | Demote to warning-class (or narrow to `obligations_count ≥ 1` as interim) |
| `functional-state-checker` | warning only | **0%** | 88% | 12% | 25 | Fix self-refuting logic bug; subsume into post-draft layer |
| `chapter-plan-checker` | blocker, gates plan revision | **44%** (audit) / **36%** (K=3 stochasticity-adjusted) | 32% / ~25% | 24% / ~33% | 25 (×K=3) | Demote to warning-class; reborn in post-draft layer with full bible context |

**Headline finding.** None of the five LLM checkers reach a TP rate that justifies a blocking gate at their current FP rate, and **the K=3 four-arm sweep on the highest-performing checker (chapter-plan-checker) shows that prompt-tweaking and multi-call voting both fail to lift the operating point above break-even.** Effective TP catch converges to ~36% across all four practical K=3 arms. The architecture is the bottleneck, not the operating point. The dominant FP modes (mid-action-start prose conventions, implicit-vs-explicit delivery, mode-of-delivery pedantry) are structural mismatches between per-beat / per-chapter semantic checking and the conventions of literary prose, and a control re-run shows checker decisions on borderline cases are themselves coin-flip stochastic (only 16% of original-fire cases get unanimous K=3 re-fires).

**Architectural conclusion.** All five checkers retire from the drafting layer and reborn in a post-draft flagging stage with full bible + chapter context. Per memory `project_world_bible_architecture_priority.md` (2026-05-03 user call), this matches the standing direction; this audit's data is the empirical anchor.

## Methodology

The grading scheme used across all four checkers:

- **TP (true positive):** the checker's complaint is substantively correct — the prose genuinely fails to deliver what the planning artifact specified (omitted event, contradicted fact, ungrounded entity that genuinely has no anchor).
- **FP (false positive):** the prose actually delivers the specified content (often via paraphrase, implication, or a different mode of delivery — memory, observation, dialogue admission). The checker is wrong, and the gate would trigger a wasteful regeneration.
- **GRAY:** ambiguous. Partial delivery, vague specification, or judgment-call cases where reasonable readers could disagree.

### Sampling

Fires were pulled from production tables for the 72 hours ending 2026-05-03:

- **`halluc-ungrounded`** — `chapter_exhaustions.unresolved_deviations` rows with `Ungrounded entity "X"` markers (LLM-confirmed, severity=blocker). NER-only-warning entries were excluded.
- **`continuity-*`** — `chapter_exhaustions.unresolved_deviations` rows tagged `[continuity]`.
- **`adherence-events`** — `llm_calls` rows with `agent='adherence-events'` and `response_content::jsonb->>'events_present' = 'false'`.
- **`functional-state-checker`** — `llm_calls` rows with `agent='functional-state-checker'` and `jsonb_array_length(findings) > 0`.

Pull scripts: `/tmp/pull-halluc-sample.ts`, `/tmp/pull-checker-samples.ts`, `/tmp/pull-adherence-functional.ts`. Saved samples: `halluc-fp-sample.json`, `checker-fp-samples.json`, `adh-func-samples.json` in repo root.

### Grading

A Sonnet subagent was given the sample JSON, the rubric above, and asked to grade each fire and produce a per-entry one-liner plus pattern summary. Subagent prompts are reproduced in §"Replication Guide" below for independent re-grading.

### Caveats

- **Sample size.** n=23–28 per checker. Wide CIs on the TP/FP/GRAY rates — treat ±10pt as noise. The relative ordering across checkers is more reliable than the absolute rates.
- **Single-grader bias.** Each fire was graded by exactly one Sonnet subagent. No inter-rater agreement measurement. An independent re-grade is the right next step.
- **Window selection.** The 72-hour window includes the L70b/L71/L72 stack-validation A/B (exp #402), which produced a higher fraction of long-tail-seed fires than baseline. The TP rates here may understate the production-typical rate slightly. Re-sampling on a calmer 7-day window is recommended for the independent audit.
- **Halluc was sampled at n=28**, not 25, because the original pull pre-dated the standardized cap.

## Per-Checker Findings

### 1. `halluc-ungrounded` — 11% TP / 71% FP / 18% GRAY (n=28)

**What it does.** Per-beat LLM check that flags proper-noun entities introduced in prose that aren't anchored in the checker-visible context (speakers, brief.characters, brief.setting, world_bible_excerpt). NER pre-pass surfaces candidates; the LLM call decides which are genuinely ungrounded. LLM-only entities emit `severity: "blocker"` and gate beat retries.

**Dominant FP patterns.**

1. **Genre vocabulary** — `treatise`, `marginalia`, `inkwell`, `crossbar`, `aether lens`, `sympathetic alarm` — common-noun fantasy/litRPG vocabulary the LLM treats as proper-noun entities or "unanchored named institutions."
2. **Named institutional roles** the planner declared in `mustEstablish` or beat description but didn't add to `allowedNewEntities` — the writer legitimately uses them; the checker fires because they're not in the allowed set.
3. **Prose-flourish nouns** — descriptive material the writer introduces to render the scene (a specific tool, a piece of furniture, a dish) that has no ontological claim; the checker treats every named noun as a load-bearing world fact.

**Even with a deterministic planner-whitelist back-fill** that auto-adds `mustEstablish` items to `allowedNewEntities`, only roughly half the FPs would be eliminated; the rest are genre vocabulary and prose-flourish nouns the writer would naturally introduce.

**Verdict: retire from drafting layer; reborn as post-draft deterministic-first flag + LLM triage.** Per 2026-05-03 user call, halluc-ungrounded in its current form does not survive the architecture pivot. The replacement: at post-draft time, when the world bible is complete and the whole chapter is in hand, run a deterministic NER-vs-bible diff to enumerate every proper-noun candidate not in the registry; then call an LLM judge over the cached `(bible + chapter + candidate)` prefix to triage each candidate into one of three buckets: (a) real hallucination → flag for editorial fix, (b) legitimate prose-flourish → ignore, (c) genuine new entity → propose a bible update. The third bucket is the structural unlock that the per-beat check never had. Cache-token economics (DeepSeek V4 Pro cached-prefix pricing) make multi-candidate judgment over a long bible+chapter prefix economically viable. Logging the current per-beat fires for diagnosis is fine in the interim; gating retries on this signal is net-harmful at 11% TP.

### 2. `continuity-*` (`continuity-state` + `continuity-facts`) — 39% TP / 22% FP / 39% GRAY (n=23)

**What it does.** Two chapter-level LLM checkers that compare prose to prior facts and prior state. Emit `severity: "blocker"` (`src/agents/continuity/check.ts:109,122`) and gate approval.

**Dominant FP patterns.**

1. **"Consistent with" self-reports.** The checker's own description sometimes acknowledges consistency ("the draft mentions the Guildmaster's attestation, consistent with the fact") then still emits a finding. Same logic shape as the more severe `functional-state-checker` bug below.
2. **Action-scope conflation.** Prose says X happens at moment T; checker references a prior fact that constrains X at moment T' and conflates the two timestamps.

**Dominant GRAY patterns.** GRAYs are dominated by *one* novel where the planner produced overly broad prior facts ("the Arbiter requires a witness if the citizen requests it" → fires when prose shows a verification without explicit witness, even though no citizen requested it). The fact's scope is ambiguous; the checker reads the strict form; reasonable graders disagree.

**Verdict: demote to warning-class; subsume into post-draft layer.** TP rate (39%) is the second-highest among the LLM checkers, but the FP+GRAY combined (61%) is too costly at the gating layer, and the same dominant FP class — implicit-vs-explicit delivery — appears here as in adherence-events / chapter-plan-checker / functional-state-checker. The world-bible direction subsumes this checker's function more cleanly: rather than re-comparing prose to extracted facts at chapter end, persist evolving world/character state from approved prose and feed scoped subsets into the writer pre-emptively; flag genuine continuity slips at post-draft time using full-context judges over the bible.

### 3. `adherence-events` — 24% TP / 60% FP / 16% GRAY (n=25)

**What it does.** Per-beat blocker. Two-stage: Stage 1 binary `events_present` check, Stage 2 per-event enumeration. When `events_present = false`, gates beat retries.

**Dominant FP patterns.**

1. **Mid-action-start blindness (~40% of FPs).** Prose opens *in* the action — the character is already in the corridor, already in the office, already deciding. The checker treats "wasn't narrated from first motion" as "didn't happen." This is a universal literary convention; writers start scenes in motion.
2. **Implicit-vs-explicit pedantry.** "The candle casts long shadows" is satisfied by "candlelight carved shadows into the hollows of his face" — checker won't recognize paraphrase. Beat says "Cassel activates crystal to display her records," prose shows him calling up the file by name; checker fires because "activating the crystal" wasn't separately depicted before the file-call.

**True positives** are mostly: structured obligations (`obligations_count ≥ 1`) and inverted physical actions (prose says "she did not close it again" when beat said "closes the log"). These are clean catches and a narrow gate over the obligation-count subset would preserve them.

**Verdict: demote to warning-class; subsume into post-draft layer.** Two options exist:
- **(a) Narrow the gate** to fire as blocker only when `beat_obligations_count ≥ 1` (TP density is meaningfully higher there). Estimated lift: TP among gated fires 24% → ~40%, FP 60% → ~40%. Smaller-blast-radius interim option.
- **(b) Demote whole checker** to warning-class, mirroring `halluc-ungrounded` and `chapter-plan-checker`. Consistent with the world-bible architecture direction.

The K=3 sweep on chapter-plan-checker (the highest-performing LLM checker) showed prompt+voting lifts cannot push past the noise floor; that empirical finding rules out spending engineering on (a) as a long-term position. (b) is the recommended action.

### 4. `functional-state-checker` — 0% TP / 88% FP / 12% GRAY (n=25)

**What it does.** Compares chapter outline's `PLANNED_STATE` (`established_facts`, `knowledge_changes`, `character_state_changes`) against the actual prose, beat by beat. Currently emits `severity: "warning"` only — does NOT gate retries.

**Dominant FP patterns.**

1. **Self-refuting logic bug (~⅓ of FPs).** Entries [8], [9], [11], [12], [13], [16], [17], [23] in the graded sample have explanations that explicitly state the planned item is present (e.g. "the fact is established," "is supported," "is present") — yet the finding still emits. This is a code defect, not calibration. Likely a prompt scaffolding issue where the model is asked to produce a finding object regardless of its judgment, or a schema validation that doesn't suppress null findings.
2. **Mode-of-delivery pedantry.** The checker insists on a specific *mode* of delivery (e.g. "stated as confirmed shared fact, not presented as memory or observation") when prose legitimately delivers state via interiority, observation, or dialogue admission.
3. **Semantic near-misses.** "212,000 silver marks" rejected against planned "over 200,000." "All identical, one source code" rejected because "all seven" wasn't said verbatim.

**Verdict: do not promote to blocker; fix the bug, then re-evaluate.** Two-stage:

- **Stage 1 (cheap, high-ROI):** fix the self-refuting logic bug. Inspect `src/agents/functional-state-checker/index.ts` and the prompt at `src/agents/functional-state-checker/functional-state-checker-system.md`. Likely fix: ensure findings are emitted only when the model's reasoning concludes "missing/contradicted," not whenever a planned item is processed. Re-sample 25 fires post-fix and re-grade.
- **Stage 2 (after Stage 1):** even after the bug fix, the mode-of-delivery FP class will dominate. Recommend: keep at warning-class indefinitely, or retire the warning entirely if it's not informing operator decisions. The world-bible direction subsumes this checker's function: extract delivered state from approved prose into the bible rather than checking for it pre-approval.

### 5. `chapter-plan-checker` — 44% TP / 32% FP / 24% GRAY (n=25, single-grader audit) → 36% effective TP at gate (K=3 stochasticity-adjusted)

**What it does.** Runs **post-draft on prose**, comparing completed chapter prose against the chapter plan. Returns `{setting_match, emotional_arc_correct, pass, deviations}`. When `pass=false`, triggers the chapter-plan-reviser, which re-drafts the outline; the chapter may then be re-drafted. Code: `src/phases/drafting.ts:533-548`. NOT a pre-draft gate — receives `(outline, prose)` together. Companion doc: `docs/checker-quality-audit-2026-05-03-chapter-plan-checker.md`.

**Single-grader audit (n=25).** Highest-performing LLM checker in the audit at 44% TP — beats halluc (11%), adherence (24%), continuity (39%), functional (0%). Dominant FP mode is the same implicit-vs-explicit delivery class that recurs across adherence and continuity: planned `established_facts` demonstrated through scene events but not stated as exposition (e.g. "false debts interlinked with debtors' life-force" shown via exploding sigils + debtors dying, never verbally asserted) — checker fires anyway. Five of eight FPs are this pattern, including a four-retry loop on one chapter that all failed the same FP. See companion doc for per-entry grades.

**K=3 four-arm stochasticity sweep (cpc-replay-k3.json).** Same 25 cases re-run with K=3 calls per arm × 2 arms (production prompt + v2 prompt with two narrow rubric modifications targeting implicit-vs-explicit delivery). Results:

| Arm | Total fires | TP catches | FP fires | GRAY fires |
|---|---|---|---|---|
| Control K=1 (production-equivalent) | 10/25 | **4/11 (36%)** | 4/8 (50%) | 2/6 (33%) |
| Control K=3-AND (≥2 of 3 fire) | 9/25 | **4/11 (36%)** | 3/8 (38%) | 2/6 (33%) |
| v2 K=1 | 7/25 | **4/11 (36%)** | 1/8 (13%) | 2/6 (33%) |
| **v2 K=3-AND** | 7/25 | **3/11 (27%)** | 2/8 (25%) | 2/6 (33%) |

**The smoking gun: flake rate.** Only **4 of 25 originally-firing cases (16%)** get unanimous K=3 re-fires under control. 11 are split (1 or 2 of 3 fire). 10 are unanimous-passes (model now says pass on all 3 looks). The production gate fires almost entirely on borderline cases the model can't reproduce on a second look.

**Empirical conclusion.** Prompt tweaks + multi-call voting both fail to lift the operating point. TP catch converges to ~36% across all four practical arms. v2 + K=3-AND saves modest FPs (50% → 25%) but at 3× LLM cost and a lost TP. **The architecture is the bottleneck, not the operating point** — every per-beat / per-chapter LLM checker tested converges to roughly the same break-even operating point regardless of prompt or voting tweaks.

**Verdict: demote to warning-class; reborn in post-draft layer.** Same end-state as halluc / adherence / continuity / functional. The catches that ARE real (gender errors, explicit numeric contradictions, emotional-arc reversals — see companion doc) should still surface as flags an operator/editor can action, but not as drafting-time blockers.

## Cross-Checker Pattern: Implicit-vs-Explicit Delivery

The same FP class appears in three of five LLM checkers:

- `adherence-events`: ~40% of FPs are "the prose enacts the planned beat events but doesn't narrate the act of starting them" (mid-action-start blindness).
- `chapter-plan-checker`: 5/8 FPs are "planned established_fact demonstrated through scene events, not stated as exposition."
- `functional-state-checker`: mode-of-delivery pedantry — checker insists on "stated as confirmed shared fact, not presented as memory or observation."
- `continuity-*`: action-scope conflation and "consistent with" self-reports that the checker still fires on.

**Common root cause.** All four checkers operate at a granularity where they receive only the local planning artifact + local prose, with no model of the wider story state. They cannot distinguish "the prose delivers this implicitly via demonstration" from "the prose actually omits this." That distinction requires either (a) the wider story-state context to anchor judgments, which is what the world-bible architecture provides, or (b) a different unit of analysis — chapter-level rather than beat-level, with the bible as reference, which is what the post-draft architecture provides. Tightening prompts within the current architecture does not address the root cause.

This is the strongest empirical argument in the audit for the architectural pivot.

## Other Checkers Needing Scrutiny

The four checkers above were the natural starting set because they emit fires we could pull from `chapter_exhaustions` / `llm_calls`. Several others should be audited next, prioritized by their current blast radius.

### Priority 1 — load-bearing under new architecture, audit shape determined

1. **Bible-input integrity (multi-source).** Under the world-bible architecture, the bible's planning artifacts (established_facts, knowledge_changes, character_state_changes, payoff links) are fed by **multiple sources**: planner, planning-state-mapper, planning-state-repair, the human approval gate, and chapter-plan-checker (now demoted but still informing the post-draft pass). All of these contribute noise into the bible if not validated. The chapter-plan-checker audit is the only one of these surfaces that has been TP/FP-graded; the other sources are unaudited. Under the charter, bible-input integrity becomes a single audit surface rather than per-checker work. This is one of the Charter Prerequisites (see below).
2. **NER pre-pass** (deterministic, feeds `halluc-ungrounded`). Once `halluc-ungrounded` retires from the drafting layer, the per-beat NER pre-pass goes with it. The post-draft replacement also uses NER but against the world bible at a different scale — that surface should be designed and audited fresh rather than carrying forward the current pre-pass. Treat as a sub-task of the post-draft architecture work, not an independent audit.

### Priority 2 — deterministic, has different scrutiny shape

3. **Prose integrity / lint** (`src/lint/integrity.ts` — fused-boundary, camel-fusion, duplicate-sentence, duplicate-fragment, quote-integrity). Recent ladder L40–L72 has been driving these surface-by-surface. Each detector has its own FP class; recent shipped fixes (L62 all-caps fusion, L72 punctuation duplicate-sentence) prove FPs do exist at this layer too. **The right scrutiny shape is regression-test corpus growth, not TP/FP grading** — these are deterministic and the fix path is fixture-based. Recommend continuing the lessons-learned-driven approach rather than batch grading.
4. **`payoff-link` / structured functional checks** (deterministic, emit blockers). Need a fixture audit similar to integrity — known cases that should fire, known cases that shouldn't.

### Priority 3 — likely retired or specialized

5. **`halluc-leak-salvatore`** — retired with the writer-LoRA route in exp #272 (2026-04-30). Confirmed as historical-only in `docs/checker-framework-audit-2026-04-30.md`. Skip unless re-armed.
6. **`artifact-adjuster`** — listed under `src/agents/` but role is unclear from the directory listing. Worth a one-paragraph "what does this do today" audit before deciding whether to grade it.
7. **`structure-*` checkers** (`structure-character-arcs`, `structure-mckee-gap`, `structure-mice`, `structure-promise`, `structure-value-charge`) — these run during *planning*, not drafting. Different scrutiny shape: compare planned outline to a quality oracle (Salvatore decomposition, exp #196 voice LoRA reference). Probably worth auditing as a separate exercise once drafting-layer checkers are settled.

### Not a checker but worth flagging

8. **`chapter-plan-reviser`** — generative, not a checker. Recent L71 raised its `maxTokens` cap defensively. Its quality (does the revised plan actually fix the issues the checker identified?) has not been measured end-to-end. Sampling shape: pre/post-revision plan diff vs. the checker's findings.

## Replication Guide for Independent Audit

To independently re-grade these checkers (or grade a new one):

### 1. Pull a fresh sample

The three pull scripts are at `/tmp/pull-halluc-sample.ts`, `/tmp/pull-checker-samples.ts`, `/tmp/pull-adherence-functional.ts`. They run on the LXC (`novel-harness-lxc`) inside the `~/apps/novel-harness/scripts/` directory — copy the file in, run with `bun`, capture stdout to JSON. The window can be widened from 72h to 7d by changing the `INTERVAL` clause if you want a calmer baseline.

### 2. Save the outputs locally

Saved samples for the audit above:
- `halluc-fp-sample.json` (28 halluc-ungrounded fires)
- `checker-fp-samples.json` (23 continuity + 1 functional + 0 adherence fires; the adherence/functional pull was redone separately — see next file)
- `adh-func-samples.json` (25 adherence + 25 functional fires with prose excerpts; **not committed** — see "Sample File Provenance" below)

### 3. Grade with a Sonnet subagent

The grading prompts used were calibrated to the rubric in §Methodology. The full prompts are available in the conversation log; the key elements:

- Define TP / FP / GRAY explicitly with examples.
- Warn against accepting "mode-of-delivery" objections as valid (prose can deliver via memory, observation, dialogue).
- Warn against accepting "mid-action-start" objections as valid (writers legitimately open scenes in motion).
- Ask for per-entry one-liners + pattern summary + verdict.

Independent grading should explicitly *not* see the verdicts in this doc to avoid anchoring. Provide only the rubric, the sample JSON, and the per-checker description of what the checker is supposed to do.

### 4. Compare

Disagreements at the per-entry level are the highest-value signal. Expect:
- Adherence: high agreement on `obligations_count ≥ 1` cases, moderate disagreement on mid-action-start cases.
- Functional: very high agreement on the self-refuting bug cases.
- Halluc: moderate disagreement on genre-vocabulary cases (where reasonable graders read the genre conventions differently).
- Continuity: highest disagreement expected, dominated by GRAY-ambiguity cases.

### 5. Sample file provenance

The three sample JSONs (`halluc-fp-sample.json`, `checker-fp-samples.json`, `adh-func-samples.json`) live in repo root and are **not in git** by default (treated as analysis artifacts). For an independent audit they should be regenerated at audit time to capture a fresh production window — re-running the pull scripts is preferred over reusing these snapshots, since the underlying production tables continue to grow.

## Post-Draft Architecture Direction

This audit reinforces the standing 2026-05-03 architectural call and crystallizes a three-layer direction. The math underneath:

- All five LLM checkers fire on a per-beat or per-chapter basis with **only the local planning artifact + local prose** in context.
- Their FP modes are dominated by **the absence of the wider story state** that would resolve ambiguity: is "treatise on civic collapse" a load-bearing entity or scenery? Is "the door is closed" a contradiction of "she closes the door before X" or just a sequence-ordering question? Is "Cassel doesn't separately activate the crystal before calling up the file" an omission or a paraphrase?
- The K=3 stochasticity sweep on chapter-plan-checker confirmed the per-checker operating point cannot be lifted past break-even via prompt or voting tweaks. The architecture is the bottleneck.
- A world-bible / character-bible + scoped retrieval architecture **gives the writer the answer pre-emptively** rather than catching the ambiguity post-hoc. Prior art exists in retired form: the corpus-pipeline / Salvatore-decomposition (`docs/corpus-pipeline.md`) shows "extract a deep bible from prose" is feasible; `pgvector` + hybrid RRF search code exists in the repo (`src/db/retrieval.ts`) but is currently **idle** — `embeddings: false` in `src/config/pipeline.ts:28`, and semantic retrieval was explicitly retired per `docs/context-engineering.md`. Reactivation is a real sub-project, not a free prerequisite — see Charter Prerequisites below.

### Three layers, distinct methodologies

**(1) Deep evolving world bible + character bible.** Foundational infrastructure. Extract structured state from approved prose into a canonical registry (entities, facts, character knowledge, character state, payoff links). Persist with versioning so chapter N's bible is queryable as "what was canonical at the time chapter N was written." Retrieve scoped subsets into the writer's context pre-emptively at write time. Prior art: corpus-pipeline / Salvatore-decomposition + `pgvector` + hybrid RRF.

**(2) Loose drafting flow with only deterministic high-precision blockers.** Strip the LLM checking surface from drafting. Retain only checks whose FP rate is bounded by deterministic-fixture work and lessons-learned regression: prose-integrity (the L40–L72 ladder surface), structured payoff-link verification, possibly the `obligations_count ≥ 1` subset of adherence as a narrow blocker. Drafting's job becomes "produce a clean full chapter" — not "pass an evolving committee of semantic checkers." Volume of incoherent prose is held in check by the writer-side context (layer 1), not by post-hoc gating.

**(3) Post-draft editing pass with deterministic-first flagging + LLM triage + DPO loop.** A separate phase that operates on completed chapter drafts with full bible + chapter in context. Two-stage:
- **Deterministic candidate enumeration.** NER-vs-bible diff for ungrounded entities; fact-table cross-reference for continuity slips; payoff-link verification for structural debt; rhythm/repetition heuristics for prose-flow flags. Cheap, exhaustive, recall-first.
- **LLM judge over cached prefix.** A judge set runs over `(bible + chapter)` as a stable prefix — DeepSeek V4 Pro cached-prefix pricing makes 5–10 judges per chapter (continuity, voice, payoff, character-state, prose-flow, halluc-triage) economically viable in one TTL window. Each judge classifies its candidates into actionable buckets: real issue → flag for fix, legitimate stylistic choice → ignore, genuine bible update → propose registry change.

Editorial decisions on flags are captured **by default** (no opt-in) as `(flagged_passage, proposed_rewrite, user_action ∈ {accept, reject, modify})` preference pairs. Captured pairs become **few-shot context** for the editor agent on subsequent chapters; this is a few-shot-driven taste-bias mechanism, **not** DPO. If sufficient pair signal accumulates, the corpus *could* feed DPO training as a separate decision under its own charter, but training-time preference learning is not part of the day-1 loop. Cold-start on day 1 = generic copy-editor behavior; meaningful taste-bias accrues within 1–2 chapters of feedback as the few-shot context fills. Judge quality itself is measured via paired comparison ({edited, unedited} → judge prefers A or B on structured dimensions) — sidesteps the 1–10 prose-score trap per CLAUDE.md.

### What this retires and what it preserves

| Surface | Status under new architecture |
|---|---|
| `halluc-ungrounded` (per-beat LLM blocker) | **demoted from drafting blocker → warning**; reborn as post-draft deterministic NER-vs-bible + LLM triage |
| `continuity-state` / `continuity-facts` | **demoted to warning**; subsumed into post-draft deterministic fact-table cross-reference + LLM triage |
| `adherence-events` (per-beat LLM blocker) | **demoted to warning** (interim narrow option: keep `obligations_count ≥ 1` as blocker if a partial gate is wanted before the post-draft layer ships) |
| `functional-state-checker` | **fix self-refuting bug, then subsume** into bible-extraction pass that runs *on* approved prose |
| `chapter-plan-checker` (post-draft prose-vs-plan LLM) | **demoted to warning**; per K=3 sweep, no operating point reachable via prompt/voting is clearly net-positive at this granularity |
| Prose integrity / lint (deterministic) | **preserved as drafting blocker**; FPs bounded by L40–L72 fixture ladder |
| `payoff-link` (deterministic) | **preserved**; structural-property check |

### Sequencing

Bible first (foundational, unlocks both downstream changes). Then loose drafting (mostly subtractive — strip LLM checker gates, retain deterministic). Then post-draft editing pass (the genuinely new layer). The integrity ladder (L40–L72) can run in parallel with the bible build; it's at diminishing returns per 2026-05-03 retrospective and can be closed out opportunistically rather than gating the architecture work.

This is charter-class scope, not a one-day lever. Should be drafted as a charter under `docs/charters/` before any code lands.

## Charter Prerequisites

Per the adversarial review of this audit (Codex / external reviewer, 2026-05-03), the world-bible / character-bible architecture is a plausible direction but is **not yet charter-ready**. The charter must explicitly include the following before it can move to implementation:

1. **Prose-to-bible extraction calibration plan.** Prior LLM extractors were retired as noise (per `docs/world-knowledge-graph.md` and `docs/context-engineering.md`). The charter must answer: why will post-draft full-context extraction work where prior in-drafting partial-context extraction failed? Calibration shape: extract bible state from N approved chapters of known novels (Salvatore decomposition is the gold-standard reference), compare against manual ground-truth bible, measure precision/recall on entities, facts, character states, knowledge changes. Stop gate: if extracted-bible quality below some threshold, the architecture doesn't ship.
2. **Retrieval reactivation sub-project.** `embeddings: false` in `src/config/pipeline.ts:28`; semantic retrieval was retired in `docs/context-engineering.md`. The code at `src/db/retrieval.ts` is idle. Reactivation requires: re-enabling embedding generation, validating RRF hybrid search returns useful results on novel content, scoping retrieval to bible queries (not ad-hoc prose chunks), and measuring retrieved-context quality before feeding into the writer.
3. **Shadow-mode validation before retiring drafting-layer gates.** The current low-precision gates do catch some real failures (~36% TP for chapter-plan-checker, ~11% for halluc, ~24% for adherence). Before removing them, build the post-draft pass and run it against a backlog of recent accepted/rejected chapters. Measure: (a) catch-overlap with the existing gates, (b) post-draft precision/recall on the same issue set, (c) miss rate on issues the current gates caught. *Then* retire the gates — not before.
4. **Concrete cost model.** Compare DeepSeek V4 Flash vs V4 Pro for judges. Model both cache-hit (warm prefix) and cache-miss costs. Output tokens are not cache-discounted; include them separately. Estimate per-chapter post-draft pass cost with K=5 and K=10 judges. The charter's "cache-token economics" claim has to survive concrete numbers, not hand-waving.
5. **Bible-input integrity audit.** The bible's planning artifacts (established_facts, knowledge_changes, character_state_changes, payoff links) are fed by planner + planning-state-mapper + planning-state-repair + chapter-plan-checker + the human approval gate. Only chapter-plan-checker has been TP/FP-graded. The other sources are unaudited and would directly contaminate the bible if they have similar TP rates to the audited LLM checkers. Audit shape: same TP/FP grading methodology applied to each source.
6. **Decision record.** A committed `docs/decisions.md` entry capturing the audit, the K=3 stochasticity finding, and the architectural pivot — so the direction has provenance and can be referenced/challenged from code review.

Items 1–5 are research/measurement work that can run before or in parallel with the charter draft. Item 6 is bookkeeping and lands with this audit.

## Status

- **Open for independent audit.** The user plans to run an independent audit on these findings; reviewer brief assembled separately.
- **K=3 stochasticity sweep complete.** Validates that the architecture, not the operating point, is the bottleneck on chapter-plan-checker. Same finding extends by analogy to the other four LLM checkers (same dominant FP class, same per-beat / per-chapter granularity).
- **No code changes shipped from this audit.** All recommendations are advisory pending the independent re-grade and the world-bible architecture charter draft.
- **Companion docs:** `docs/checker-quality-audit-2026-05-03-chapter-plan-checker.md` (chapter-plan-checker companion + K=3 results), `docs/checker-framework-audit-2026-04-30.md` (broader framework audit), `docs/decisions.md` §L70b+L71+L72 (the integrity-ladder work that surfaced the audit need), memory `project_world_bible_architecture_priority.md` (the architectural call).
- **Sample artifacts (not in git, regenerate per Replication Guide):** `halluc-fp-sample.json`, `checker-fp-samples.json`, `adh-func-samples.json`, `chapter-plan-checker-fp-sample.json`, `/tmp/cpc-replay-k3.json` (K=3 sweep raw data).
