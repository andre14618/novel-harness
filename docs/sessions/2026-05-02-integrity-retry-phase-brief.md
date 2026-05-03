---
status: active
updated: 2026-05-02
role: phase-data-brief
session: 2026-05-02-runner-archive-and-litrpg-validate
phase: lint-integrity-guard + chapter-attempt-retry
---

# Phase Data Brief — Lint/Integrity Guard + Chapter-Attempt Retry

## Phase Definition

The phase begins after the writer emits chapter prose and the post-fix lint pass completes; it ends when the chapter is either approved (raw + post-fix prose accepted by `detectProseIntegrityIssues`) or the chapter exhausts attempts (silently `paused`). Inputs: assembled chapter prose + planner outline + prior-attempt integrity issue list. Outputs: an approved draft, a regenerated draft, or a paused exhaustion (no plan-assist gate today).

**Code surface:**
- `src/lint/integrity.ts` — five issue kinds + matched-pair extraction (`pairNorm`)
- `src/phases/drafting.ts:229-1383` — chapter-attempt loop, `maxDraftAttempts = 3`
- `src/agents/writer/retry-context.ts:123-138` — `formatChapterIntegrityRetryContext` carry-over
- `src/config/pipeline.ts:3` — budgets (`maxDraftAttempts`, `maxBeatRetries`, `maxValidationPasses`, etc.)

## Volume Evidence (last 14 days, n=182 chapters)

| family | occurrences | distinct novels | share |
|---|---:|---:|---:|
| duplicate-fragment | 28 | 9 | 58.3% |
| duplicate-sentence | 7 | 6 | 14.6% |
| fused-boundary | 8 | 1 (L61) | 16.7% |
| quote-integrity | 5 | 4 | 10.4% |
| camel-fusion | 0 | 0 | 0% |
| **duplicate family total** | **35** | **12 unique** | **72.9%** |
| **fusion + quote total** | **13** | **5 unique** | **27.1%** |

**Chapter outcomes:**
- approved on attempt 1: 85 / 182 (46.7%)
- approved after ≥1 retry: 88 / 182 (48.4%) — retry-novel approval rate **90.7%**
- never approved: 9 / 182 (4.9%)

## Escalation Pattern

Multi-fail chapters within the window (n=6):

| novel | ch | t1 | t2 | t3 | shape |
|---|---:|---:|---:|---:|---|
| novel-1777591510985 | 1 | 1 | 2 | — | mild rise |
| novel-1777698707087 | 1 | 1 | 2 | — | mild rise |
| novel-1777709036403 | 1 | 1 | **8** | — | sharp escalation |
| novel-1777712370271 | 1 | 4 | 2 | — | decay |
| novel-1777719198533 | 1 | 3 | 2 | 1 | clean decay |
| **novel-1777761636607 (L61)** | **1** | **1** | **5** | **7** | **canonical 1→5→7** |

**3 of 6 escalate**, 2 decay, 1 mild-rise-but-still-escalating. The escalation cases concentrate the duplicate family.

## Code Pathology Evidence

L41's `priorIntegrityIssues` carry-over (`retry-context.ts:123-138`) passes a chapter-wide list of `${kind}: "${excerpt[:200]}"` entries plus three generic instructions, appended to **every beat's** userPrompt on retry. Three structural problems:

1. **No beat attribution.** When attempt 1 emits a duplicate-fragment that spans (say) beat 4 and beat 9's prose, attempt 2 regenerates **all 13 beats** with the same chapter-wide list. The writer has no way to know beats 4 + 9 collided — only that "the chapter contained one." Fresh beats can land duplicates in new places.

2. **No matched-pair payload.** `detectAdjacentDuplicateSentences` already produces `pairNorm` (`integrity.ts:74-85`) — the actual two-sentence collision text — but the carry-over discards it and only passes the kind + a 200-char excerpt of one side. The writer is told "you duplicated something" without seeing what collided.

3. **No integrity exhaustion plan-assist gate.** Adherence/continuity blockers route to `pendingExhaustion → presentForExhaustion` (operator gate). Integrity exhaustion sets neither — it `continue`s silently and pauses on attempt 3 with `chapter-attempts-exhausted:ch${ch}`. No human gets the edit-plan/override/abort decision.

## Trace Evidence — Writer Response To L41 Carry-Over

Pulled all `beat-writer` `llm_calls` rows where `request_json.messages[].content` contained `AVOID THESE INTEGRITY ISSUES`. Only 2 chapters in the DB carried the block (the feature is recent). Verbatim carry-over example from `llm_calls.id=58676` (novel-1777761636607 ch1 t3):

```
--- AVOID THESE INTEGRITY ISSUES FROM YOUR PRIOR DRAFT ---
- fused-boundary: "tters faded: *SCRIBE.GUILD.VALDRIS.MARET.ANN"
- fused-boundary: "faded: *SCRIBE.GUILD.VALDRIS.MARET.ANNUAL.*"
- fused-boundary: "SCRIBE.GUILD.VALDRIS.MARET.ANNUAL.* She cou"
- fused-boundary: ".GUILD.VALDRIS.MARET.ANNUAL.* She could sti"
- quote-integrity: "The cross-reference on folio 47-B indicated a varianc..."

Keep sentence boundaries clean (period + space + capital). Do not repeat the same phrase verbatim across paragraphs. Pair and attribute every quote mark.
```

Compared attempt-1 issues to attempt-2 issues across the 2 retry-equipped chapters:

| novel | ch | t1 issue | t2 outcome | verdict |
|---|---|---|---|---|
| 1777761636607 | 1 | duplicate-sentence / `Don't look at me.` | `Don't look at me.` GONE; new fused-boundary pathology emerged | **different-kind** |
| 1777761636607 | 1 (t2→t3) | fused-boundary / `…SCRIBE.GUILD.VALDRIS.MARET.ANN` | fused-boundary at *different offsets* in same SCRIBE.GUILD construct | **different-duplicate** (sliding-window survival of generator) |
| 1777761636607 | 1 (t2→t3) | quote-integrity / `The cross-reference on folio 47-B…` | duplicate-sentence / paraphrased "folio twelve-B…" appeared twice | **different-kind** (writer paraphrased the warned quote, then duplicated the paraphrase) |
| 1777721066908 | 2 | duplicate-fragment ×2 + quote-integrity | t2 PASSED | **resolved** |

**Conclusions:**
- Writer **obeys the literal-string prohibition** — every named excerpt in the carry-over disappeared in the next attempt.
- For `fused-boundary`, the **underlying generator survives**: the writer kept emitting the SCRIBE.GUILD.VALDRIS.MARET.ANNUAL token-stream construct with shifted surrounding text, so the detector matched a different window. Generator-level pathology, not literal-pair. *L62's regex carve-out closes this at the detector layer; no writer-side fix needed for this kind.*
- For `duplicate-sentence`/`-fragment`, the **fresh-prose-elsewhere pattern is real**: the writer evaded the warned text and duplicated *paraphrased* content elsewhere. Lever A (showing `pairNorm` so the writer sees both halves of the collision) addresses this cleanly because it surfaces the *type of duplication* — not just the offending phrase. Lever A's volume target (72.9% of integrity-fail mass) and its causal fit are now both supported by evidence.

## Phase Question Implications

Three orthogonal levers, sequenced by leverage × cost:

### Lever A — Pass matched-pair text for duplicate-fragment family (HIGH leverage, LOW cost)

Surface the actual matched pair to the writer for duplicate-* kinds. Rationale: duplicate family is 72.9% of volume; `pairNorm` already exists in `integrity.ts:81`; carrying it through to `formatChapterIntegrityRetryContext` is a few-line change. Expected effect: writer sees the collision, paraphrases one side instead of regenerating fresh prose that may collide elsewhere.

**Acceptance:** on a fixed retry-replay panel of the 6 multi-fail chapters above, attempt-2 duplicate-issue counts trend down (vs the current attempt-1 baseline) on the duplicate-only subset. No regression on fusion/quote subset.

### Lever B — Route integrity-exhaustion to plan-assist (MEDIUM leverage, MEDIUM cost)

When chapter integrity fails on attempt N == `maxDraftAttempts`, set `pendingExhaustion = { kind: "integrity-exhausted", ... }` instead of silently `paused`. Mirror the existing adherence/continuity dispatch shape. Rationale: only 9 chapters in 14 days exhaust this way (4.9%), but they're the operator-invisible cases today.

**Acceptance:** on a forced-exhaustion fixture, the run halts at the plan-assist gate with the integrity issue list rendered for the operator. Smoke-stop classifier returns `human_needed` (currently it returns `human_needed` for the wrong reason — `gates_total=0` because no gate fires).

### Lever C — Beat-attribute integrity issues + targeted beat-rewrite (HIGHER leverage, HIGHER cost)

Extend `detectProseIntegrityIssues` to map char-offsets to originating `beatProses[i]`, then route to a targeted beat-rewrite path analogous to chapter-plan-checker's settle loop (`drafting.ts:650`). Rationale: cuts blast radius, preserves clean beats on retry.

**Acceptance:** on the same retry-replay panel, attempt-2 retries regenerate ≤3 beats (not all 13). Issue counts must not increase.

## Recommended Sequencing

1. **L63 = Lever A first** (matched-pair carry-over for duplicate family). Smallest, highest-volume, no architectural shifts.
2. **L64 = Lever B** (plan-assist exhaustion gate). Operator visibility; small structural change.
3. **L65 = Lever C** (beat-attributed integrity + targeted rewrite) — only if A+B don't close the duplicate-family escalation pattern observed in 3 of 6 multi-fail chapters.

Levers A and B can land in either order; A is sequenced first because the volume is higher and the change is smaller.

## Cross-References

- `docs/sessions/2026-05-02-L61-e2e-smoke-after-hardening-result.md` — original escalation finding
- `docs/sessions/2026-05-02-L62-litrpg-integrity-guard.md` — closed the FP cluster that surfaced the secondary finding
- `docs/decisions.md` §L41 — chapter-wide carry-over precedent
- `src/agents/writer/retry-context.ts` — carry-over surface
- `src/lint/integrity.ts` — `pairNorm` already produced

## Pending Validation

L62-validate smoke (exp #386, `fantasy-system-heretic`, deployed commit `31e16a8` on LXC) is still running. Awaited verdict will either:
- **(a) Clean pass** → close L62 lane; advance L63 (Lever A) immediately.
- **(b) New blocker on the L61 secondary finding** → reinforces L63 priority; the smoke chapter-1 attempt-by-attempt issue counts populate the empirical baseline for the retry-replay panel.
- **(c) Different blocker** → re-evaluate phase priorities before L63.
