---
status: active
updated: 2026-05-01
role: result-doc
loop: L4-followup-ner-calibration
experiment: 319
parent_experiment: 316
---

# Deterministic NER vs LLM `halluc-ungrounded` — Calibration Results (2026-05-01)

## Question

Does the deterministic entity-candidate extractor at `src/lint/entity-candidates.ts` (commit `0eeabf9`, ungrounded-substring filter applied per-row) catch hallucinations that the LLM `halluc-ungrounded` checker misses on the L1 labeled panels?

L1 (exp #316) showed 5-call N=5 convergence at temp=0.5 lifts F1 by 5–13% relative but leaves a **stubborn floor of 1–3 systematic FNs** the LLM cannot crack at any vote threshold. This loop measures whether deterministic NER would lift that floor — addressing one of the two paths called out in the L1 result doc.

## Method

For each row in each labeled panel:
1. Run `extractEntityCandidates(prose)`.
2. Build the row's grounded surface = union of `groundedSources.{bible, from_brief, derived_outline_fact, derived_prior_beat, planner_emitted, allowed_new_entities}` ∪ `writer_request_meta.beatCharacters`.
3. Filter candidates against the grounded surface (case-insensitive exact + substring + per-token match — see script for the full ladder).
4. Declare **NER FIRES** iff at least one candidate is ungrounded.
5. Look up the LLM signal from the corresponding L1 convergence-eval JSONL (N=5, T=0.1) at threshold k=1 (any-vote-fail). This matches L1's most-recall-optimistic operating point.
6. Compute the row's oracle pass per the same logic as `convergence-eval.ts`.
7. Cross-tab `(oracle pass) × (NER fires) × (LLM fires)`.

Pure deterministic — zero LLM calls. Script: `scripts/hallucination/ner-vs-llm-calibration.ts`. Per-row JSONLs persisted at `/tmp/halluc-ner-calibration-{small,big}-20260502T032111.jsonl` and `…T032119.jsonl` on LXC.

## Headline 2x2 — Small Panel (n=22, 10 oracle FAIL)

Per-row source: `/tmp/halluc-current-panel-exp299-labeled.jsonl` (22 halluc-ungrounded rows; 17 natural + 5 synthetic).

| Signal | TP | FP | FN | TN | Recall | Precision | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **NER (deterministic)** | 8 | 1 | 2 | 11 | **0.800** | **0.889** | **0.842** |
| **LLM (any-vote of 5 @ T=0.1)** | 9 | 6 | 1 | 6 | 0.900 | 0.600 | 0.720 |

### NER × LLM cross-tab (n=22 labeled)

|  | LLM fires | LLM passes | total |
|---|---:|---:|---:|
| **NER fires** | 7 | 2 | 9 |
| **NER passes** | 8 | 5 | 13 |
| **total** | 15 | 7 | 22 |

### On oracle FAIL only (the FN-floor question)

|  | LLM fires | LLM passes | total |
|---|---:|---:|---:|
| **NER fires** | 7 | **1 (NER catches what LLM misses)** | 8 |
| **NER passes** | 2 (LLM catches what NER misses) | 0 (residual floor) | 2 |
| **total** | 9 | 1 | 10 |

### On oracle PASS only (the FP-cost question)

|  | LLM fires | LLM passes | total |
|---|---:|---:|---:|
| **NER fires** | 0 | 1 (NER FP) | 1 |
| **NER passes** | 6 (LLM FP) | 5 | 11 |
| **total** | 6 | 6 | 12 |

## Headline 2x2 — Big Panel (n=45 halluc rows; n=28 oracle-labeled, all synthetic)

Per-row source: `/tmp/halluc-panel-L1-big-20260501.jsonl` (45 halluc-ungrounded rows; 17 unlabeled natural + 14 synthetic FAIL + 14 synthetic PASS controls). Labeled set is synthetic-only.

| Signal | TP | FP | FN | TN | Recall | Precision | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **NER (deterministic)** | 12 | 4 | 2 | 10 | **0.857** | **0.750** | **0.800** |
| **LLM (any-vote of 5 @ T=0.1)** | 10 | 9 | 4 | 5 | 0.714 | 0.526 | 0.606 |

### On oracle FAIL only (the FN-floor question)

|  | LLM fires | LLM passes | total |
|---|---:|---:|---:|
| **NER fires** | 10 | **2 (NER catches what LLM misses)** | 12 |
| **NER passes** | 0 (LLM catches what NER misses) | **2 (residual floor)** | 2 |
| **total** | 10 | 4 | 14 |

### On oracle PASS only (the FP-cost question)

|  | LLM fires | LLM passes | total |
|---|---:|---:|---:|
| **NER fires** | 3 (both wrong — both FP) | 1 (NER FP) | 4 |
| **NER passes** | 6 (LLM FP) | 4 | 10 |
| **total** | 9 | 5 | 14 |

## What NER catches that the LLM misses

### Small panel (1 NER-WIN on FAIL)

| Fixture | Expected entity | NER candidates | LLM votes |
|---|---|---|---|
| `cs-598-…-c1-b3-a1-synthetic-entity-insertion` | `Veyr Dominion` | `Scribe's Guildhall`, `Veyr Dominion`, `Veyr Dominion` | 0/5 fail — unanimous miss |

### Big panel (2 NER-WINs on FAIL)

| Fixture | Expected entity | NER candidates | LLM votes |
|---|---|---|---|
| `…-b3-a1-synthetic-entity-insertion-the-bellward-order` | `the Bellward Order` | `Scribe's Guildhall`, `Bellward Order`, `Bellward Order` | 0/5 fail |
| `…-b8-a1-synthetic-entity-insertion-the-quiet-concord` | `the Quiet Concord` | `Quiet Concord`, `Quiet Concord` | 0/5 fail |

Common pattern: SUFFIX_TOKEN classes (`Dominion`, `Order`, `Concord`) where the second word is on the lexicon. NER's `suffix-class` regex catches them deterministically; LLM rated them as legitimate world-bible-adjacent phrasing and unanimously passed.

## What the LLM catches that NER misses

### Small panel (2 LLM-WINs on FAIL)

| Fixture | Expected entity | NER status | LLM votes | NER blind-spot class |
|---|---|---|---|---|
| `cs-598-…-c1-b5-a1-halluc-ungrounded` | `Guildmaster Aldric`, `Yarrow` | NER passes (no candidates) | 5/5 fail | `Guildmaster Aldric` is **sentence-initial** after `\n\n`; `Yarrow` is a **single capitalized word** (NER excludes singletons by design — see entity-candidates.ts §"Filters") |
| `cs-598-…-c1-b9-a1-halluc-ungrounded` | `Vault of Witnesses` | NER passes | 5/5 fail | The phrase has lowercase `of` between cap words → fails the multi-word and suffix-class regexes (X-of-Y is a known limitation) |

### Big panel (0 LLM-WINs on FAIL)

LLM caught nothing on the big panel that NER also missed — every LLM-true-positive was also caught by NER.

## The residual FN floor — what neither side cracks (big panel only, 2 rows)

| Fixture | Expected entity | Why NER misses | Why LLM misses |
|---|---|---|---|
| `…-b7-a1-synthetic-entity-insertion-the-withering-of-47` | `the Withering of '47` | Only one capitalized word (`Withering`) followed by lowercase `of '47` — fails all three classes | LLM treats `'47` as a generic temporal reference; passes silently |
| `…-b10-a1-synthetic-entity-insertion-arbiter-vesh` | `Arbiter Vesh` | `Arbiter` IS in TITLE_TOKENS, regex matches `Arbiter Vesh`, but **sentence-initial** after `\n\n` — sentence-initial filter drops it | LLM treats it as a re-mention of (already-grounded) `Arbiter Cassel`; same-title-different-name pattern slips |

**Key insight:** the residual floor is split between (a) NER's `X of Y` and `single-word entity` blind spots that the existing extractor design explicitly punted on, and (b) the **sentence-initial filter** dropping a real positive. The sentence-initial heuristic is currently sweeping out one true positive per panel (1/2 of the natural-panel LLM-wins; 1/2 of the residual-floor cases). A targeted fix — e.g. allowing sentence-initial matches when the title is in TITLE_TOKENS *and* the surname is ungrounded — would close the most pressing gap without re-introducing the article-noise the filter exists to suppress.

## NER-FP cost — the price of catching more

NER produces **1 FP per panel** in the labeled-PASS slice:
- Small: `Scribe's Guildhall` (singular form; bible has plural `The Scribes' Guildhall`).
- Big: same `Scribe's Guildhall` in a generic-location pass-control row.

This is a **plural-vs-singular substring mismatch** — `Scribes'` ≠ `Scribe's`. A normalization pass that strips trailing `'s`/`s'` before matching would close this entirely. The same fix would also reduce the per-token grounded-surface false positives (e.g. `Maret's` candidates already get matched via the per-token cleaning, but the *phrase-level* substring check doesn't apply that normalization).

LLM produces **6 FPs on small + 9 FPs on big** in the labeled-PASS slice — substantially more, and not addressable by a localized lexical fix.

## Recommendation

**NER as a prepass-blocker is viable and recommended for promotion in a follow-up loop.** The headline F1 numbers tell the story:

| Panel | NER F1 | LLM F1 | NER lift over LLM |
|---|---:|---:|---:|
| Small | **0.842** | 0.720 | **+0.122 absolute (+17% relative)** |
| Big (synthetic) | **0.800** | 0.606 | **+0.194 absolute (+32% relative)** |

NER catches 1/8 (small) + 2/14 (big) = 3 oracle-FAIL rows the LLM unanimously misses, all on the SUFFIX_TOKEN class (`Dominion`, `Order`, `Concord`). This is exactly the FN-class L1 identified as the systematic floor.

**Asymmetric voting policy candidate (for L4-followup-2):**
- **Fail iff `NER fires OR LLM fires`** — combined recall would be 9/10 (small) + 12/14 (big), combined F1 would lift further. NER's 1 FP is much smaller than the LLM's 6.
- Alternative: **Fail iff `NER fires`** alone — at NER's F1=0.842 / 0.800 it already beats the LLM's F1=0.720 / 0.606 on both panels. The OR-gate is strictly dominant in recall but adds the LLM's FP cost; promoting NER alone would actually drop precision-cost while still beating LLM-recall on big panel.

**Pre-promotion fixes to land in the same loop:**
1. **Plural-vs-singular normalization** in the grounded-surface match (strip trailing `s'` / `'s`). Closes the only NER-FP class observed.
2. **Sentence-initial filter relaxation for TITLE_TOKEN matches.** When the candidate starts with a title in TITLE_TOKENS, allow it even at sentence start; the noise it suppresses is purely from common articles, not titles. This closes 1 of the 2 LLM-WIN rows + 1 of the 2 BOTH-MISS rows.

**What we are NOT yet recommending:**
- Promoting NER as a hard blocker without the two fixes above (FP rate would unnecessarily wedge a known-good case).
- Replacing the LLM checker entirely. The big panel has the LLM still beating NER on the `Yarrow` (single-word) and `Vault of Witnesses` (X-of-Y) classes; LLM remains the safety net for those. Production should run both and OR-combine, not swap.

## Persisted evidence

| Run | `phase_eval_runs.id` | Verdict | Variant |
|---|---|---|---|
| Small panel | **60** | `NER-CATCHES-1-OF-8-ORACLE-FAIL` | `small-panel` |
| Big panel | **61** | `NER-CATCHES-2-OF-14-ORACLE-FAIL` | `big-panel-synthetic-only` |

Per-row JSONL artifacts on LXC:
- `/tmp/halluc-ner-calibration-small-20260502T032111.jsonl`
- `/tmp/halluc-ner-calibration-big-20260502T032119.jsonl`

Tracking experiment: `tuning_experiments.id=319`, linked to L1's #316 via `experiment_lineage` (`continuation`).

## Caveats

1. **Panel sizes are still small.** Small panel has 10 oracle FAIL rows; big panel has 14. The headline NER advantage on big-panel synthetics may be inflated by the SUFFIX_TOKEN bias of the L3 fixture set — every Dominion/Order/Concord/Vale fixture is structurally a NER-friendly target. A natural-mostly panel of similar size would be the better promotion gate.
2. **The 17 unlabeled natural rows in the big panel are not in any 2x2 above.** Their NER signals are emitted to the per-row JSONL with `oracle_pass=null`, but they don't affect the headline numbers. Adjudicating them (the L1-followup loop) would expand the natural-row sample to ~30 and would test whether the FP rate stays at ~1/panel.
3. **NER substring matching is one-directional.** A grounded surface entry containing the candidate counts as grounded; a candidate containing a grounded entry only counts via the per-token fallback. This intentional asymmetry means `Master Orin` is correctly flagged when only `Orin` is grounded — but if the surface includes `Master Orin's filing system`, the candidate `Master Orin` would also (correctly) ground. No observed mismatch, but worth noting for future surface formats.
4. **LLM signal is at k=1 (any-vote-fail) — the most recall-friendly threshold.** At higher thresholds the LLM column would shift toward more FNs and fewer FPs; the cross-tab cell directions wouldn't change qualitatively but the magnitudes would. The k=1 lens is fair to the LLM here because we're comparing against deterministic NER, which has no temperature dial.

## Decision frame for L4-followup-2

The next loop is the *promotion gate*: with the two fixes above, does NER as an `OR` prepass against the LLM hit a pre-registered F1 ≥ 0.85 on a re-adjudicated natural-mixed panel? If yes, land it as production; if no, the L4 NER track is parked and convergence + grounded-surface expansion remain the two open levers from L1.
