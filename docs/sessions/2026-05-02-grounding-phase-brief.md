---
status: active
updated: 2026-05-02
role: phase-data-brief
session: 2026-05-02-grounding-phase-brief
phase: grounding (halluc-ungrounded chapter-attempt retry)
---

# Phase Data Brief — Grounding (halluc-ungrounded Chapter-Attempt Retry)

## Phase Definition

The phase begins after the writer emits beat prose and the per-beat checker fan-out runs (`runBeatChecks` → adherence + halluc-ungrounded in parallel); it ends when the chapter is approved, accepted-with-warnings, or exhausts via plan-check at the chapter-attempt level. Inputs: chapter outline, world bible, character roster, prior beat, NER prepass + LLM-confirmed checker output. Outputs: an approved draft, an accepted-with-warnings draft, or a `plan-check-exhausted` plan-assist gate.

**Code surface:**
- `src/agents/halluc-ungrounded/index.ts` — V1 NER prepass + LLM checker; `BEAT_ENTITY_LIST_VARIANT=v1` is default
- `src/lint/entity-candidates.ts` — NER candidate extractor + `normalizeForGroundedMatch`
- `src/phases/drafting.ts:360-417` — per-beat retry loop (`previousProse` + `previousIssues = checks.retryLines`)
- `src/phases/beat-checks.ts` — `runBeatChecks` aggregation
- `src/agents/writer/retry-context.ts` — `formatChapterIntegrityRetryContext` (integrity-only; **no halluc analog exists**)

## Volume Evidence (last 14 days)

| exhaustion kind | count | halluc-ungrounded cited | share |
|---|---:|---:|---:|
| plan-check-exhausted | 44 | 11 | **25.0%** |
| reviser-rejected | 1 | 0 | 0% |

11 chapters in 14 days bailed at the plan-assist gate with halluc-ungrounded as a contributing cause. Compare to integrity-driven exhaustion in the prior phase brief: 9 chapters in 14 days. The grounding phase has higher operator-visible blocker volume than integrity did.

## Code Pathology Evidence — Architectural Gap

The integrity phase shipped a chapter-attempt-level carry-over (`formatChapterIntegrityRetryContext` at `retry-context.ts:123` → "AVOID THESE INTEGRITY ISSUES FROM YOUR PRIOR DRAFT"). **There is no parallel surface for halluc-ungrounded findings.** Per-beat retries within a chapter-attempt do feed `checks.retryLines` back via `previousIssues` (`drafting.ts:404`), but when the beat eventually accepts-with-warnings or the chapter-attempt fails and re-runs from scratch, the next chapter-attempt's beat-writer call gets the same context with no record of which entities were previously flagged as ungrounded.

**Consequence (empirical):** on novel-1777768466618 ch1 beat 13, the chapter-attempt loop ran 3 times. Beat-writer LLM calls 58907 / 58910 / 58913 (attempts 1/2/3) produced **byte-identical prose** including the ungrounded "central spire's heartbeat records." The writer literally cannot avoid an entity it doesn't know was flagged.

This is exactly the structural failure mode that L41 → L63 closed for the integrity guard. The grounding phase is one ladder rung behind.

## Trace Evidence — Smoke Case Study (exp #389, fantasy-debt ch1 beat 13)

**Planner beat 13 outline (id 58907 user_prompt):**
> *POV: Maret. Setting: Scribe's Guildhall, Midtown. Kind: dialogue. Maret stumbles over a question about her first level-up. She claims not to remember, but Cassel notes that the System records show she has never leveled. She feels the trap closing.*

No mention of "central spire," "regional node," "heartbeat records," or "cross-referencing logs."

**Writer prose (id 58907 response_content):**
> *"It does." Cassel's tone was gentle in the way a surgeon's is before the knife. "And as you can see, that subprotocol has never recorded an adjustment for your account. I have cross-referenced the regional node's backup logs. I have verified the timestamps against the **central spire's heartbeat records**. The data is consistent."*

**Verdict:** writer-drift, not planner-introduced. The writer inflated atmospheric LitRPG/system-tech detail in service of Cassel's interrogation tone. No grounding source for "central spire" exists in the bible, planner outline, prior beats, or NER allowlist.

**Chapter-attempt 2 retry critique (id 58910 user_prompt):**
The retry-with-critique block listed 5 ungrounded entities flagged by the per-beat checker — but **"central spire" was not among them**. The block surfaced "Ceremony of Ascension," "Scribe Maret," "The Framework," "Skill Point" (all `[NER-only warning — LLM passed]`), and one true LLM-confirmed `Kepten, Maret N.`. The actual chapter-blocking entity was filtered out before reaching the writer.

This is a second, finer-grained pathology: the writer-facing critique surface for halluc-ungrounded does not faithfully represent the issues that the chapter-level halluc-ungrounded checker uses to gate exhaustion. Operator-visible bail cause and writer-visible critique are disjoint.

## Phase Question Implications

Three orthogonal levers, sequenced parallel to the integrity phase's A/B/C laddering:

### Lever G-A — Carry-over of confirmed-ungrounded entities to next chapter-attempt (HIGH leverage, LOW cost)

Mirror `formatChapterIntegrityRetryContext`: pass an explicit "AVOID THESE UNGROUNDED ENTITIES FROM YOUR PRIOR DRAFT" block to the writer's userPrompt on chapter-attempt ≥ 2. Source: union of LLM-confirmed ungrounded entities across all beats in the prior chapter-attempt. Volume target: 25% of plan-check exhaustions in 14 days. Implementation cost: a `formatChapterUngroundedRetryContext` function + a list-assembly pass over the prior attempt's beat-check results.

**Acceptance:** on a forced-replay against the byte-identical-prose case (ch1 beat 13 of novel-1777768466618), attempt 2's prose differs from attempt 1's prose in the cited entity. Per-beat retry critique faithfulness is *out of scope* for G-A — that's G-A2.

### Lever G-A2 — Faithful per-beat critique surface (MEDIUM leverage, LOW cost)

Make sure `checks.retryLines` for halluc-ungrounded includes every LLM-confirmed entity, not just a filtered subset. Investigate why "central spire" wasn't in the attempt-2 critique despite being the chapter-blocking issue. Likely a data path bug between the checker's confirmed-ungrounded set and the writer-facing retry list.

**Acceptance:** instrument the path; reproduce; fix; verify against the same case.

### Lever G-B — Writer-side BIBLE-binding constraint (MEDIUM leverage, MEDIUM cost)

Tighten the writer's system prompt or beat-context to enforce "use only entities from {bible, beat brief, character roster, prior beat, sanctioned new-entities}." Currently the prompt allows narrative invention; the checker catches it after the fact. This is a primary-prevention lever vs. G-A's secondary-correction lever.

**Acceptance:** A/B test on a fixed seed panel; ungrounded fire rate drops by ≥10 pts on first-attempt prose. Risk: over-constrains LitRPG atmospheric detail and produces flatter prose.

### Lever G-C — Planner-side sanctioned new-entities list per beat (HIGH leverage, HIGH cost)

Extend the chapter-outline schema with a per-beat `sanctionedNewEntities` field: the planner explicitly enumerates new named entities that *should* appear in this beat (e.g., a previously unseen artifact). The checker would then ground against this list as well. Closes the case where a beat *needs* a new entity that isn't in the bible yet.

**Acceptance:** planner output schema migrated; checker consumes the new field; beat-level FP rate drops on legitimate-new-entity beats.

## Recommended Sequencing

1. **Lever G-A first** (chapter-attempt carry-over). Smallest, highest-volume hit, exact mirror of the L41 → L63 ladder we just shipped. Forced-replay validates without paid tokens.
2. **Lever G-A2 in parallel or immediately after** if the attempt-2 critique gap reproduces broadly — it's a low-cost data-path fix.
3. **Lever G-B** (writer-side constraint) — A/B before shipping, since it has degrade-prose risk.
4. **Lever G-C** (planner sanctioned-entities) — only if A + A2 + B don't bring fire rate into target. Schema migration is the largest lift in the phase.

## Cross-References

- `docs/sessions/2026-05-02-integrity-retry-phase-brief.md` — sister-phase brief; structure + lever-ladder pattern
- `docs/sessions/2026-05-02-L64-integrity-exhaustion-gate.md` — exp #389 smoke that surfaced this phase
- `src/agents/halluc-ungrounded/index.ts` — checker code + V1/NER calibration history (exp #254)
- `src/agents/writer/retry-context.ts` — carry-over surface to extend
- `src/phases/drafting.ts:360-417` — per-beat retry loop
- `chapter_exhaustions` table — 14-day baseline
- DB IDs of interest: novel-1777768466618 ch1 beat 13 → llm_calls 58907 / 58910 / 58913 (writer) and 58908 / 58911 / 58914 (checker)

## Pending Validation

The phase brief is investigation-only; no code changes. Next concrete step is to open lane L65-G-A, mirroring L63's lane shape: implement `formatChapterUngroundedRetryContext`, unit tests, retroactive replay against the byte-identical-prose case (no new smoke required for unit acceptance).

## Live-Smoke Update (exp #392, fantasy-archive, post-L65)

3-chapter live smoke on `fantasy-archive` after L65 shipped. Outcome:

- **Chapter 1**: integrity-fail attempt 1 → approved attempt 2. L41/L63 carry-over verified live (13/13 attempt-2 beat-writer prompts carry both the AVOID INTEGRITY block and the L63 paraphrase-one-side directive).
- **Chapter 2**: integrity-fail att1 (1 issue) → integrity-fail att2 (2 issues, escalation) → bailed at **plan-check-exhausted** on `halluc-ungrounded: "Senior Cataloguer"`.
- **Smoke-stop-classifier**: `new_blocker`.

**Critical new evidence — different failure mode than exp #389:**

| chapter-attempt | beat 0 contains "Senior Cataloguer" | halluc-ungrounded fired on |
|---|---|---|
| 1 | no | "Third Lamentation" / "Seventh Lamentation" (resolved in per-beat retries) |
| 2 | no | (passed cleanly) |
| 3 | **yes (newly invented)** | "Codex" (retry 2) → "Senior Cataloguer" (retry 3, cap hit) |

The exp #389 case ("central spire" byte-identical across all 3 attempts) was a *persistence* failure — same entity reused. exp #392 is a *drift-invention* failure — writer invents **fresh ungrounded entities each chapter-attempt**, never repeating the same one. L65's carry-over architecture is correct: at chapter-attempt 3's final per-beat retry, `priorUngroundedEntities` captures "Senior Cataloguer" — but there's no chapter-attempt 4 to consume it.

**Implication for lever sequencing:**

- L65 (G-A) closes the *persistence* failure mode and is non-regressive. Confirmed.
- The *drift-invention* failure mode is not addressable by chapter-attempt carry-over alone — by the time the writer invents a new ungrounded entity, the next chapter-attempt may invent a different one. This points to **Lever G-B (writer-side BIBLE constraint)** as the higher-value next lever — primary prevention vs secondary correction. **G-B priority elevated** ahead of G-A2.
- G-A2 (faithful per-beat critique surface) remains relevant if a future smoke shows persistence-mode failure where the chapter-blocking entity is a different one than what's in the per-beat critique. But the exp #392 trace shows the per-beat critique correctly named the entity at retry 3 — no critique-faithfulness gap on this case.

## Lever Sequence Update (post-L66 KILL + G-A2 closure, 2026-05-02)

**G-B v1 KILL (exp #393 + #394).** L66 v1 prompt edit reduced halluc-ungrounded fires by 79% but regressed chapter-1 approval (v0=1/2 → v1=0/1) on `fantasy-archive`. The class-categorical constraint pushed prose toward duplicate-fragment integrity escalations and NER number-word-tail false positives. Lever direction validated; form over-corrected. Reverted per stop gate (b). See `docs/sessions/2026-05-02-L66-writer-bible-binding.md`.

**G-A2 closed as not-a-real-lever (exp #395 investigation).** Tracing exp #389 beat 13 halluc-ungrounded calls (ids 58908 / 58911 / 58914) showed the per-beat critique IS faithful — it correctly carries attempt-N findings to attempt N+1's beat-writer prompt. The apparent gap (chapter bails on entity X but writer's critique lists A, B, C) is **stochastic LLM checker behavior** on byte-identical prose: same prose, different flagged entities each call. No data-path fix needed; closing G-A2 without a code change.

**New analysis — what exp #389's true failure mode actually is.** Earlier framing called it "byte-identical persistence" and contrasted with exp #392's "drift-invention." Tracing the per-beat halluc calls shows exp #389 was *partially* a persistence failure (writer prose unchanged) and *partially* a checker-stochasticity failure (each chapter-attempt's LLM checker flagged a different subset of the entities present). L65's chapter-attempt carry-over captures the *union* across attempts, which is still the right secondary-correction lever. Without L65, attempt 4 would have started with no record of the prior attempts' entity flags.

**Real next lever — G-D (NEW): multi-call halluc-ungrounded with vote/union.** Run the LLM checker N≥2 times per beat (parallel via Promise.all, no extra latency), take the union of LLM-confirmed blockers. Addresses checker stochasticity directly — same prose, more entities surfaced per call. Cost: 2-3× halluc-ungrounded inference, which is ~20% of total cost → ~20% total cost increase. Localized change to `runBeatChecks` in `src/phases/beat-checks.ts`. Validation: A/B smoke comparing single-call vs N=2 (or N=3) on `fantasy-archive` or `fantasy-debt`; metric is approval rate and total chapter-blocking entities surfaced.

**Updated lever sequence:**
1. L65 G-A — shipped, non-regressive (closes persistence-mode where prose IS unchanged across attempts).
2. ~~L66 G-B v1~~ — REVERTED stop gate (b). Direction right, form over-corrects. Future v2 needs narrower scope (e.g. invented uppercase names only; or paired with planner sanctioning).
3. ~~L67 G-A2~~ — closed as not-a-real-lever after investigation.
4. **L68 G-D — multi-call halluc-ungrounded vote/union (NEXT).**
5. L69 G-C — planner sanctioned-new-entities schema migration. Largest schema lift; only worth opening if G-D doesn't move the approval rate.
6. (deferred) L66 v2 — narrower writer-side constraint. Re-evaluate after G-D ships.
