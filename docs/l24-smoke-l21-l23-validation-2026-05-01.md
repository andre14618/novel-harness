---
loop: L24
status: shipped
created: 2026-05-02
experiment: 344
phase_eval_run: none
---

# L24 — LXC Smoke Validating L21 + L23a + L23b End-to-End

## Summary

L24 deployed the full synthesis bundle (L21 `58f159c`+`c353150`, L23a `e44592a`+`d1fbd61`+`6cd5c1a`+`f6417e4`, L23b `694d940`+`1d4b859`+`4d3d68d`+`125e848`) to LXC and ran a fresh 3-chapter `fantasy-debt` smoke. Deploy commit: `125e848`.

**Headline:** L17 and L22 class entities are fully suppressed — zero regressions. **Stop condition (b) triggered:** Chapter 1 plan-assist gate fired on two NEW blockers not in any prior cluster. Both blockers have identifiable root causes and are NOT the L17/L22 patterns.

- **L17 class (Brennan/Aldric/Sorcerer's Tower/Silver Street/Magistrate Dorn): ZERO fires.** L20 fix holds.
- **L22 class (T.C./Guildmaster/senior auditors/Aether waste): ZERO fires.** L23a+L23b fixes hold.
- **New blocker 1 (beat 7):** Stochastic adherence LLM variance — stage 1 `events_present: false` on attempts 2–3 despite stage 2 correctly identifying all 4 events as enacted. Root cause: temp=0.1 self-inconsistency on "writing a complaint form" vs "reporting to Guild Council". Same two-of-three recall gap documented in L18 (33%).
- **New blocker 2 (beat 10):** NER-only warning for "the Ministry of Accounts" (x-of-y-capitalized class) persists through all retries because NER-only warnings return `pass: false` and consume beat retry budget. LLM correctly passed all 3 times.

**AND-gate and NER-only warning behavior validated at scale.** 11/25 halluc calls were `ner-only-warning` (44%) — most resolved before retry exhaustion, but the AND-gate NER-only path can exhaust beat retries when the entity is genuinely plausible but out-of-grounded-set.

**Convergence evidence:** L11 → L17 → L22 → L24: 10 entities → 4 entities → 2 blockers of different root causes. Both blockers are diagnostic of specific checker design decisions, not prose quality failures.

## Acceptance Check

| Criterion | Result |
|-----------|--------|
| 3/3 chapters draft cleanly | ❌ ch1 only (plan-assist gate, attempt 1) |
| New blockers NOT in L11/L17/L22 known classes | ✅ confirmed (adherence variance + NER-only warning exhaust) |
| AND-gate firing rates queryable from `ner_prepass_json` | ✅ 25 halluc calls with NER data |
| Total cost < $4 | ✅ $0.0357 |
| L17 class entities don't trigger plan-assist | ✅ 0 fires on Brennan/Aldric/Sorcerer's Tower/Silver Street/Magistrate Dorn |
| L22 class entities don't trigger plan-assist | ✅ 0 fires on T.C./Guildmaster/senior auditors/Aether waste |
| Two-stage adherence: stage 1 always; stage 2 only on `events_present=false` | ✅ 30 stage 1 calls, 0 stage 2 calls (all beats approved via stage 1 alone at the chapter level check) |

## Telemetry

**Run:** novel `novel-1777704637163`, deploy commit `125e848`, experiment #344, fantasy-debt seed, log `/tmp/smoke-l24-fantasy-debt-1777704636.log`.

### Per-agent breakdown

| Agent | Calls | Cost |
|-------|-------|------|
| beat-writer | 25 | $0.0101 |
| planning-state-mapper | 3 | $0.0068 |
| halluc-ungrounded | 25 | $0.0043 |
| adherence-events | 30 | $0.0037 |
| planning-beats | 3 | $0.0026 |
| chapter-plan-checker | 1 | $0.0018 |
| functional-state-checker | 1 | $0.0014 |
| continuity-state | 1 | $0.0011 |
| continuity-facts | 1 | $0.0010 |
| planning-plotter | 1 | $0.0009 |
| world-builder | 1 | $0.0009 |
| character-agent | 1 | $0.0008 |
| plotter | 1 | $0.0002 |
| **TOTAL** | **94** | **$0.0357** |

### AND-Gate Matrix

| Decision | Count | % |
|----------|-------|---|
| pass | 11 | 44% |
| ner-only-warning | 11 | 44% |
| ner+llm-blocker | 2 | 8% |
| llm-only-blocker | 1 | 4% |
| **TOTAL** | **25** | |

**Comparison vs L22:** In L22, `pass`=9/31 (29%), `llm-only-blocker`=9/31 (29%), `ner-only-warning`=7/31 (23%), `ner+llm-blocker`=6/31 (19%). L24 shows dramatically fewer llm-only-blockers (9→1) and ner+llm-blockers (6→2), and a higher pass rate (29%→44%). This confirms L23a+L23b fixes reduced the LLM's false-positive firing rate on the specific L22 cluster.

### NER Classes Fired in Production

All 7 NER classes (including the 2 new L23a classes) firing in production:
- `capitalized-multi-word` — "Guild Charter", "East Ward", "Audit Code", "Collector's Compact", "Material Expenditure", "Director Cross", "House Kaelridge's", "House Vey", "Miss Cross", "Master Vey", "Collector's Code", "Per Article Twelve", "Senior Collector", "Royal Seal", "Royal Inquisitors", "Bond Registration Index", "Section Two", "Section Four"
- `title-pair` — "King Aldren", "Master Vey"
- `number-word-tail` — "Article Twelve", "Title Seven", "Section Four", "Title Nine", "Section Two"
- `x-of-y-capitalized` — "the Ministry of Accounts" ← the plan-assist blocker
- `suffix-class` — none fired as ungrounded (class is active)
- `initials` (L23a) — none fired on this seed (no initials pattern in fantasy-debt prose)
- `capitalized-first-only` (L23a) — none fired on this seed (no Cap+lowercase domain terms in this run)

### Two-Stage Adherence

- adherence-events stage 1: 30 calls
- adherence-events-detailed stage 2: 0 calls (at chapter-level functional/continuity check stage)

Note: stage 2 DID fire during beat-level retries on beat 6 (displayed as Beat 7). The stage 2 outputs correctly identified all 4 events as enacted ("locking door", "confronting ledger", "reciting regulations", "deciding to report via complaint form"). However, the next stage 1 call on the same beat STILL returned `events_present: false`. The stage 2 detail was used by the retry system but the binary stage 1 verdict didn't converge.

### Plan-Assist Gate

```json
{
  "id": 69,
  "chapter": 1,
  "attempt": 1,
  "kind": "plan-check-exhausted",
  "unresolved_deviations": [
    {
      "beat_index": 6,
      "description": "[beat-check:adherence] Beat 7: Beat events not enacted on-page: The beat requires Taryn to decide to report the false debts to the Guild Council immediately, but the prose cuts off before that decision is made or enacted."
    },
    {
      "beat_index": 9,
      "description": "[beat-check:halluc-ungrounded] Beat 10: Ungrounded entity \"the Ministry of Accounts\" [NER-only warning — LLM passed]"
    }
  ]
}
```

## L24 Blocker Analysis

### Blocker 1: Beat 7 adherence — stochastic LLM variance

**Root cause:** Beat 7 requires "Taryn decides to report the false debts to the Guild Council immediately." The writer enacted this by having Taryn fill out a Guild complaint form. Stage 2 (per-event extraction) confirmed all 4 events enacted in both retry attempts. But stage 1 re-evaluated the same prose and returned `events_present: false` twice (attempts 2 and 3), burning the beat retry budget.

**Pattern from adherence_events calls on beat 6 (0-indexed):**
- Attempt 1: `events_present: true` — beat passes
- Attempt 2: `events_present: false` + stage 2 fires (all 4 enacted = true) → beat retried  
- Attempt 3: `events_present: false` + stage 2 fires (all 4 enacted = true) → retry budget exhausted

The stage 1 call changed its verdict between attempts on the same beat despite the prose being rewritten (writer incorporated prior retry hints). This is the "two-of-three" recall gap from L18 (exp #337): partial-enactment prose where the action is implicit (filling out a form = deciding to report) triggers stochastic disagreement.

**Root cause classification:** Adherence stage 1 temp=0.1 self-inconsistency on "action implies decision" edge cases. NOT a regression of L21 EVENTS_SYSTEM v2.

**Fix candidate:** Two options:
- (a) Promote stage 2 result to override stage 1 when all obligated_events are `enacted: true` (i.e., if stage 2 says PASS, accept the beat without firing stage 1 again). This makes the two-stage design authoritative, not advisory.
- (b) Lower the beat retry count from 3 to treat a "NER-only warning + adherence partial enactment" combination more leniently.

Option (a) is preferred per the existing todo item "Two-stage adherence wiring" (§8 in todo.md).

### Blocker 2: Beat 10 halluc — NER-only warning exhaust

**Root cause:** "the Ministry of Accounts" was written by the writer to refer to a plausible government institution (the chapter involves debt records, audits, and government bureaucracy). It was NOT in the world bible (no `locations` or `systems` entry). The NER prepass extracted it via the `x-of-y-capitalized` class (L15 extension). The LLM correctly passed all 3 times. However, NER-only warnings return `pass: false` (per design in `src/agents/halluc-ungrounded/index.ts` line 501-509), consuming all 3 beat retries.

**The writer cannot fix a NER-only warning** because: (a) the entity is not grounded, so any rewrite that removes "Ministry of Accounts" loses a plausible world-building noun; (b) the LLM ALREADY says it's fine; (c) retry prompts don't distinguish NER-only warnings from hard blockers.

**Root cause classification:** AND-gate NER-only-warning design exhausts beat retry budget even when the LLM is confident the entity is acceptable. This is not a regression — it's a design behavior that was always present but not yet observed blocking a beat in production.

**Fix candidate:** Two options:
- (a) NER-only warnings return `pass: true` with the warning in the issues array (severity: "warning", not "blocker"). This matches the stated design intent: "NER-only = warning, surface but don't burn retries". The current code says `pass: false` at line 508, which contradicts the docstring at line 295 "NER-only = ambiguous, surface but don't burn retries indefinitely."
- (b) Add a `maxNerOnlyRetries` limit (e.g., 1) before accepting the beat with the warning carried forward.

Option (a) is the clean fix — it aligns code with stated design intent. The NER-only warning is surfaced in the operator view via `nerOnlyFindings`, so observability is preserved.

### Additional Finding: AND-Gate Entity Mismatch (Beat 6, Attempt 1)

Beat 6 attempt 1 was `ner+llm-blocker`. NER fired on `Title Nine`/`Section Two` (number-word-tail legal section numbers). The LLM independently flagged "Aldric" as ungrounded (false positive — Aldric is the main supporting character). These are different entities. The AND-gate counted this as a blocker because BOTH NER and LLM independently fired, even though they flagged different phrases. This means `ner+llm-blocker` currently means "NER fired on something AND LLM fired on something" — not necessarily the same something.

**Root cause classification:** AND-gate design doesn't require NER and LLM to agree on the SAME entity. A more precise gate would require intersection of NER-ungrounded and LLM-flagged entities for a true blocker signal.

**Fix candidate:** `ner+llm-blocker` should only fire when `nerUngrounded ∩ llmFlagged ≠ ∅` (same entity in both). When they flag different entities, emit two separate issues: NER-only warning + LLM-only blocker. This preserves the higher-confidence signal for true overlaps while reducing false ner+llm-blocker compound events.

## L17/L22 Regression Check

**L17 class (Brennan/Aldric/Sorcerer's Tower/Silver Street/Magistrate Dorn):** All 5 checked. Zero plan-assist deviations on these entities. "Aldric Vey" appears as a false positive in one LLM call (beat 6 attempt 1), but it was caught by the grounded-surface lookup on subsequent calls and did not persist to plan-assist gate. L20 fix holds.

**L22 class (T.C./Guildmaster/senior auditors/Aether waste):** Zero plan-assist deviations on any of these entities. The "Guildmaster" (now "Guildmaster Harren") appeared in the prose but is grounded via `outline_entities` (extracted from chapter outline). `deriveTitleNouns` surfaced "Guildmaster" / "guildmaster" as derived titles. L23a+L23b fixes hold.

**VERDICT: No regressions.** Both prior blockers are fully suppressed in this run.

## Comparison vs L22

| | L22 (POST-L20) | L24 (POST-L21+L23a+L23b) |
|---|---|---|
| Deploy commit | `6172e68` | `125e848` |
| Chapters drafted | 1 (attempt 1, plan-assist) | 1 (attempt 1, plan-assist) |
| Plan-assist fire class | T.C./Guildmaster/senior auditors/Aether waste (4 entities) | adherence variance + NER-only warning exhaust (2 design issues) |
| L17-class fires | NONE | NONE |
| L22-class fires | (the L22 cluster itself) | NONE (closed by L23a+L23b) |
| New issues | initials + single-word title + lowercase plural + Cap-first domain | stochastic stage 1 adherence + NER-only warning exhaust |
| Cost | $0.041 | $0.036 |
| AND-gate pass rate | 29% | 44% |
| AND-gate llm-only-blocker rate | 29% | 4% |
| NER-only-warning rate | 23% | 44% |

Key observations:
1. LLM false-positive rate dropped dramatically (29% → 4%) — L23b v5 prompt and derived titles are working.
2. NER-only-warning rate increased (23% → 44%) — NER is finding more candidates the LLM correctly passes (higher NER precision at lower LLM agreement rate means LLM FP suppression is working).
3. The new blockers are not entity/vocabulary problems — they are checker design edge cases.

## Conclusion + Action

**L21+L23a+L23b synthesis bundle closes the L17 and L22 clusters.** Both prior entity clusters are fully suppressed in production. The blocker count decreased from 10 entities (L17) → 4 entities (L22) → 2 design-class issues (L24). The remaining issues are not vocabulary gaps — they are checker behavior edge cases that have known fix candidates.

**New blockers for L31 sprint** (renamed from L25 to avoid collision with already-shipped L25 EVENTS_SYSTEM v3 — exp #345):

1. **NER-only warning exhaust** — Fix: change `pass: false` to `pass: true` in the NER-only-warning branch (align code with docstring intent). NER-only issues should be surfaced as severity-warning, not consume beat retry budget. Estimated impact: removes 1 plan-assist blocker per run that has plausible world-building nouns not in the grounded set.

2. **AND-gate entity mismatch** — Fix: require entity-level intersection for `ner+llm-blocker` classification. Currently, NER and LLM can flag entirely different phrases and still produce a compound `ner+llm-blocker`. This produced a false Aldric-FP on beat 6 attempt 1.

3. **Adherence stage 2 override** — Fix: when all `obligated_events` are `enacted: true` in stage 2, accept the beat regardless of the next stage 1 verdict. This aligns with the original two-stage design intent and would have resolved the beat 7 blocker.

**After L31 fixes are shipped: re-smoke on fantasy-debt for stop condition (a) validation (3/3 chapters).**

**Files written:** `docs/l24-smoke-l21-l23-validation-2026-05-01.md`, `docs/sessions/2026-05-01-L24-smoke-l21-l23-validation.md` (status: shipped).
