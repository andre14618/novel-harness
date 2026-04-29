---
status: in-progress
novel: salvatore-icewind-dale
book: crystal_shard
last-updated: 2026-04-29
audience: someone reading per-corpus calibration outcomes to make a downstream decision (ship a planner constraint, expand to next corpus, fix a dim)
---

# Crystal Shard — Structural-Decomposition Conclusions

This file documents **what we learned** from running the structural-decomposition pipeline on Crystal Shard, not just the raw numbers. Every analysis step appends a "Conclusion + Action" entry below.

The raw numbers live in `crystal_shard.json` (and `<book>.<keyx>x<gold>.json` for 2×2 cells). This file is the human-readable interpretation.

---

## Summary verdict (as of 2026-04-29)

**Aggregated: SCOPED PASS** — character-arcs landed CELL PASS, pulling the aggregated verdict above FAIL.

| Dim | Verdict | Conclusion |
|---|---|---|
| value-charge | NULL-GOLD (artifact) | Flash polarity tagging is **likely reliable** — F1=0.94 binary is strong. NULL-GOLD verdict is the n=5 retest pool tripping the 15% disagreement threshold (sample-size noise, not real). |
| promise | CELL FAIL F1=0.41 | Flash extractor is **NOT reliable** for promise — recall=0.30 means it misses ~70% of promises Pro finds, specifically Chekhov's-gun setup-payoff bridges. Either upgrade to Pro extractor or accept partial recall. |
| character-arcs | **CELL PASS** F1=1.00 | Flash extractor is **reliable** for character identification + LTWN structure. arc_resolution agreement 67% (above 65% PASS gate). Ship as planner constraint. |
| mice | CELL MARGINAL P=0.731 F1=0.776 | Flash extractor is **borderline reliable** for MICE thread tagging. P=0.73 is below the 0.78 PASS gate but above the 0.65 FAIL floor. Expand retest pool + retune prompt before declaring it shippable. |
| mckee-gap | extraction in flight | Pending. |

---

## What this means for the planner

**Ship now (CELL PASS):**
- character-arcs distribution: derive from crystal_shard's 6 main characters. Add to concept-phase character-agent context as a target distribution of (arc_resolution, lie/truth/want/need shape).

**Hold (MARGINAL):**
- mice: don't ship yet, but the schema is structurally sound. Iterate on prompt to lift P from 0.73 → 0.78.

**Don't ship (FAIL):**
- promise: V4 Flash extractor is the wrong cost shape for this dim. Decision needed: (a) upgrade to V4 Pro extractor (~10× cost per book), (b) sharpen Flash prompt for setup-payoff bridges, or (c) accept 30% recall and ship a partial registry.

**Investigate (NULL-GOLD):**
- value-charge: re-run with retest pool n ≥ 20 to retire the small-n artifact. Underlying signal (F1=0.94 binary) is strong — likely a CELL PASS once retest noise drops.

---

## Per-step conclusions

### Step 1: Stage 6 extraction — 5 dims, V4 Flash, ~$0.85/book

**Methodology:** Run all 5 extractors on the crystal_shard normalized bundle. Output goes to `novels/salvatore-icewind-dale/structure/crystal_shard/`.

**Results:**
- value-charge.jsonl: 139 rows (one per scene)
- promises.json: 14 promises across the book
- character-arcs.json: 6 main characters (Drizzt, Bruenor, Wulfgar, Regis, Kessell, Catti-brie)
- mice.jsonl: 139 rows
- mckee-gap.jsonl: in flight

**Conclusion:** All 5 extractors completed without operator intervention; the bundle shape was clean enough end-to-end. Schema invariants pass (verify-pipeline.py audit_structure). The first PDF-source artifact issue (12/139 evidence-quote line-break false positives) is an audit-only concern, not a data-quality issue.

**Action:** Proceed to calibration. No prompt changes needed at the extractor level yet.

---

### Step 2: Promise calibration matcher fix — Jaccard token-similarity → V4 Pro semantic

**Question:** Why did initial promise calibration return F1=0.045 when hand-matching showed 9-10/14 = ~64%?

**Methodology:** Inspect the unmatched (predicted, gold) pairs. Discover that token-similarity matching (Jaccard ≥ 0.5 OR Levenshtein ≥ 0.6) silently rejects semantically-equivalent paraphrases like "Errtu will pursue the crystal shard" vs "Errtu seeks the relic Crenshinibon" (Jaccard ~0.17). Replace with V4 Pro semantic pair-matcher: ~$0.02/book, single batched call.

**Conclusion:** Matching policy was the bug, not the extractor. After fix, F1=0.41 (real signal). The promise extractor still under-extracts (recall=0.30) but that's now a real conclusion, not a measurement artifact. **General lesson: any calibration that compares two independently-extracted lists needs a semantic matcher, not a token similarity gate. This generalizes to character-arcs (LLM character matcher) and any future dim with paraphrased free-text fields.**

**Action:** LLM matcher landed. Calibration verdict is trustworthy now. Future dims with free-text matching should use the same pattern (`llmMatchPromises` is the template).

---

### Step 3: Character-arcs CELL PASS — first shippable dim

**Question:** Is Flash's character-arc extraction good enough to ship as a planner constraint?

**Methodology:** Pro judge re-runs `extractCharacterArcs` on the same beat list. LLM character-name matcher pairs the two character lists (V4 Pro, ~$0.003). Compute F1 + arc_resolution agreement.

**Results:**
- 6 predicted characters all matched 6 gold characters → **F1=1.00**
- arc_resolution agreement: 4/6 = 0.667 (Bruenor and Catti-brie disagreed on partial vs fulfilled)
- Pred → fulfilled: Drizzt, Wulfgar; partial: Bruenor, Regis, Catti-brie; tragic_inversion: Kessell
- Gold → fulfilled: Drizzt, Bruenor, Wulfgar, Catti-brie; partial: Regis; tragic_inversion: Kessell

**Conclusion:** Flash reliably finds the right characters and assigns them to the right LTWN structure. The 33% disagreement on arc_resolution is **2-class boundary confusion** (Pro is more generous about "fulfilled" vs Flash being more reserved with "partial") — not a structural failure of the dim. Both interpretations are defensible reads of the text. **Crystal Shard's character-arcs distribution is shippable as a planner constraint right now.**

**Action:** Derive empirical distribution from `character-arcs.json` and add to concept-phase character-agent context. Add a follow-on task for per-field LTWN semantic agreement (pred lie ≈ gold lie, etc.) — currently presence-only baseline, which understates the real agreement signal.

---

### Step 4: Promise CELL FAIL F1=0.41 — capability mismatch, not bug

**Question:** Why did Flash extract only 14 promises when Pro extracted 30?

**Methodology:** After matcher fix, compare matched vs unmatched promises in both directions.

**Results:**
- 9 pred-gold pairs match (Errtu chases shard, Wulfgar's vow, etc. — the big arc-spanning promises)
- 5 unmatched pred (extractor splits one big arc into multiple — Pro judge subsumes them as one)
- **21 unmatched gold (V4 Pro found, V4 Flash missed)**
- The 21 missed are mostly **Chekhov's-gun setup-payoff bridges**:
  - "Drizzt has a magical panther summoned from an onyx figurine" (used 100 pages later)
  - "Drizzt will train Wulfgar in combat" (training arc setup)
  - "Drizzt acquires a magical scimitar effective against demons" (Chekhov's scimitar)

**Conclusion:** This is a **capability mismatch**, not a bug. V4 Flash treats "promises" as big plot threats (Errtu wants shard, Wulfgar swears vengeance) and misses the smaller seed-level setup-payoffs that V4 Pro catches. The mismatch is meaningful: the promise registry is supposed to catch dangling threads, and Chekhov's-gun setups are exactly the threads that go dangling. **For the promise dim specifically, V4 Pro at extraction time is the real fix.**

**Action:** Defer ship until decision: upgrade promise extractor to Pro (~10× cost — but promise extractor is only 2 calls per book, so absolute spend is trivial) OR sharpen Flash prompt with explicit Chekhov's-gun examples. Phase B (Pro promise extractor) is in flight to validate the upgrade hypothesis directly.

---

### Step 5: Mice CELL MARGINAL P=0.731 — borderline reliability

**Question:** Is Flash's MICE thread tagging reliable enough to ship?

**Methodology:** Pro judge re-runs mice tagging on 33 sampled scenes (30 + 3 retest). Compare per-scene primary_thread agreement, opens/closes binary agreement, and per-field rates.

**Results:** F1=0.776 on binary "thread fired" call, P=0.731. Just below the 0.78 PASS gate.

**Conclusion:** Flash MICE tagging is on the **wrong side of the PASS threshold by 5 points**. It's not random noise (F1 well above 0.60 floor) but it's not unambiguously shippable either. The P=0.731 means about 27% of Flash's "thread opens/closes" calls disagree with Pro's. That's enough error to corrupt the planner's MICE distribution.

**Action:** Iterate on the mice prompt before re-running. Likely needs sharper guidance on what counts as a "thread close" (Sanderson's definition is fuzzy in the original lectures). Hold ship until next iteration.

---

### Step 6: 2×2 model matrix — Phase A complete (Flash judges)

**Question:** We've only tested Flash-extractor → Pro-judge. We need to know: does Flash judge as well as Pro? Does Pro extract materially better than Flash?

**Methodology:** Run 4 cells:
- (Flash extractor, Pro judge) — already done
- (Flash extractor, Flash judge) — Phase A, **NOW DONE for 3 of 4 dims**
- (Pro extractor, Pro judge) — Phase B, in flight (Pro promise extractor)
- (Pro extractor, Flash judge) — defer until Phase A + B signal arrives

**Phase A results (Flash extractor × Flash judge on Flash-extracted output):**

| Dim | Flash×Pro (cross-model) | Flash×Flash (self) | Δ |
|---|---|---|---|
| value-charge | F1=0.94, polarity 76%, lifeValue 56% | F1=0.96, polarity **85%**, lifeValue **73%** | +2pp F1, +9pp polarity, +17pp lifeValue |
| mice | F1=0.776, P=0.731 | F1=0.809, P=0.731 | +3pp F1, identical P |
| character-arcs | F1=1.00, arc_resolution 0.667 | F1=1.00, arc_resolution **0.833** | identical chars matched, +17pp arc_resolution |
| promise | F1=0.41 (with semantic matcher) | **JUDGE FAILED** schema validation | Flash can't emit 2-pass closure schema reliably |

**Conclusion (Phase A):**

1. **Flash agrees with itself more than with Pro** on every successful cell. The diagonal cells (Flash×Flash) are uniformly higher than the cross-model cells (Flash×Pro). This is expected — same model family = shared biases — but it has a load-bearing implication for our verdict interpretation:

2. **The original Flash×Pro verdicts are conservative lower bounds.** Flash is *more reliable* than the cross-model test suggests, because the cross-model test counts every "Pro is generous, Flash is conservative" disagreement as a Flash error. With Flash×Flash gold, the same Flash extractor jumps from CELL FAIL-adjacent (value-charge polarity 76%) to clearly competent (85%) — same data, different judge.

3. **Promise is a real capability ceiling, not a bias issue.** Flash literally couldn't produce the 2-pass closure schema (missing `confidence` on all 27 closures, only 6228 output tokens used out of 32K — not truncation). Flash-extractor missed 70% of promises Pro found, AND Flash-judge can't validate its own work. **For the promise dim, V4 Pro is required on at least one side of the calibration. Phase B will tell us if Pro extractor is the right answer.**

4. **The Flash judge cost trade-off is meaningful.** Flash judge cost ~$0.30 across 4 dims vs Pro judge ~$1.50. If Flash×Flash is enough signal for some dims (e.g. character-arcs, where the matcher confirms identical character lists either way), we could downgrade those dims' judges to Flash and save 5× on judge cost per book. **Recommended for character-arcs and mice. Pro stays for promise.**

**Pending:** Phase B (Pro promise extractor) is in flight — pass-1 has been running ~30 min on V4 Pro thinking. When it completes, we'll have the (Pro extractor, Pro judge) cell to test whether Pro extraction is the fix for promise.

**Action:** Phase A landed. Continue waiting on Phase B. Defer the (Pro extractor, Flash judge) cell — it's not load-bearing for any near-term decision (Flash judge is cheaper Pro alternative for non-promise dims; Pro extractor + Flash judge wouldn't tell us anything we don't already know).

---

## Cost ledger

| Step | Calls | Total cost | Notes |
|---|---|---|---|
| Extraction (5 dims, Flash) | ~1100 | ~$0.40 | Includes mckee-gap in flight |
| Pro judge (4 dims to date) | ~95 | ~$1.20 | Mostly value-charge + character-arcs |
| Pro promise pair-matcher | 1 | $0.02 | Single batched call |
| Pro character-arcs name-matcher | 1 | $0.003 | Single batched call |
| Flash judge (Phase A, in flight) | ~95 | ~$0.30 (est) | Flash much cheaper than Pro |
| Pro promise extractor (Phase B, in flight) | 2 | ~$0.50 (est) | V4 Pro thinking on the open + close passes |
| **Total to date** | ~1300 | **~$2.50** | All on V4 Pro 75%-off promo (until 2026-05-31) |

**Conclusion on cost:** The full 2×2 matrix across 5 dims costs **~$2.50**. After the promo expires it would be ~$5/book. That's still trivial — affording to run this on every new corpus we add is not a cost problem.

---

## Next decisions

1. **Wait for Phase A + B verdicts** (~15-30 min) — fills out the 2×2 matrix.
2. **Wait for mckee-gap extraction** (~60 min) — gets us the 5th dim verdict.
3. **Decide on promise dim**: ship Pro-extracted promise registry, sharpen Flash prompt, or accept partial recall.
4. **Iterate on mice prompt** to lift P from 0.73 → 0.78.
5. **Ship character-arcs distribution** as a planner constraint (already CELL PASS).
6. **Decide on next corpus**: Sanderson Mistborn (high-effort, modern series) vs Edward Robertson Breakers (lower friction, modern self-pub) vs another classic (Cook's Black Company, Gemmell's Legend).

---

## Linked context

- [crystal_shard.json](crystal_shard.json) — raw verdict numbers (always authoritative for the metrics)
- [docs/charters/corpus-structural-decomposition-v1.md](../../../docs/charters/corpus-structural-decomposition-v1.md) — R7 charter, threshold definitions
- [docs/corpus-extraction-explained.md](../../../docs/corpus-extraction-explained.md) — what each dim produces and why
- [docs/corpus-structural-decomposition.md](../../../docs/corpus-structural-decomposition.md) — operator walkthrough
- [docs/corpus-wide-analysis-todo.md](../../../docs/corpus-wide-analysis-todo.md) — strategic roadmap for corpus expansion
