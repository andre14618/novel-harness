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

## Summary verdict (as of 2026-04-29 v1 close-out)

**Aggregated: SCOPED PASS — single-book** — character-arcs is shipped; mckee-gap binary is shippable; the rest re-calibrate under v2 (decomposed + Sonnet anchor; design at `docs/designs/decomposed-extractor-sonnet-anchor-v1.md`). All numbers below are **Crystal Shard book-scoped** until Streams of Silver / Storm Front cross-book validation lands.

**How to read the verdict columns:** the headline metric for each dim is the **planner-relevant subfield** (the field the harness will actually feed into a prompt), not the binary "did the dim fire" call. Binary F1s look uniformly strong across dims (≥0.89) but the planner consumes per-scene polarity / per-beat gap_size enums / per-character arc_resolution — so those agreements gate ship status, not the binary.

| Dim | v1 Verdict | Headline metric (planner-relevant) | Binary baseline | Conclusion |
|---|---|---|---|---|
| value-charge | NULL-GOLD (verdict-gate artifact) | per-scene polarity agreement **0.76**; lifeValue agreement **0.56** | F1=0.94 binary "any charge change" | Polarity is below 0.78 PASS gate but not by much; lifeValue 0.56 is the harder problem. NULL-GOLD verdict is the n=5 retest pool tripping the 15% disagreement threshold (**underpowered sample**; see verdict-protocol note below). v2 re-calibrates with Sonnet anchor + retest n ≥ 20. |
| promise | NULL-GOLD-LIKE (post-Phase C) | Gold v1↔v2 Jaccard **0.326** (Sonnet pair-matcher confirms 0.357) | n/a — discrete-list dim, no binary | Rubric admits two structurally different interpretations. v2 splits into `arc-promise` (close ≥5 chapters out) + `setup-payoff-bridge` (close ≤3 chapters out) sub-dims. |
| character-arcs | **CELL PASS — SHIPPED** | character ID **F1=1.00**; arc_resolution agreement **0.67** | n/a — character-presence is the load-bearing field | Flash extractor reliably finds the right cast and assigns LTWN structure. arc_resolution at 0.67 is 2-class boundary confusion (partial vs fulfilled), not structural failure. Live in harness as of commit `4ec5d8b` (LTWN + arc_resolution enum on `characterProfileSchema`; planner renders the arc block). |
| mice | CELL MARGINAL | per-scene primary_thread + opens/closes binary **F1=0.776, P=0.731** | F1=0.809 self-judge (Flash×Flash) | Below 0.78 PASS gate by 5pp on cross-model. v2 decomposes into 4 parallel binary calls per scene (one per M/I/C/E thread type). |
| mckee-gap | **CELL PASS (binary only)** | per-beat **gap_size** agreement **0.58**; **gap_type** agreement **0.56** | F1=0.892, P=0.925, R=0.860 binary "any gap" | Binary "gap or no gap" is shippable as a per-beat soft prior (60%+ of beats carry a gap). The per-field enums the planner actually wants (gap_size 4-class, gap_type 6-class) are below the PASS gate; v2 keeps single-call shape but anchors against Sonnet to test enum lift. |

### Verdict-protocol note — value-charge vs mckee-gap inconsistency

**Both dims posted 40% (2/5) retest self-disagreement on n=5 retest pools.** Value-charge's verdict was downgraded to NULL-GOLD on this signal; mckee-gap was waived to CELL PASS because its binary F1=0.892 was strong and the multi-class enum below-gate was treated as a separable v2 problem. The protocol applied two different rules to the same numerical signal:

- **Value-charge:** "n=5 retest 40% disagreement → trip the 15% gate → NULL-GOLD."
- **McKee-gap:** "n=5 retest 40% disagreement → call out as underpowered → grant CELL PASS on binary."

This is **not a defended methodology decision**; it is verdict drift between two sessions. Either the gate should fire at the same threshold for both or both pools need to be re-measured at n ≥ 20. Tracked as a Phase C exit task. Until resolved, the SCOPED PASS aggregated verdict carries this caveat: the value-charge NULL-GOLD verdict and the mckee-gap CELL PASS verdict were posted using non-uniform protocols.

**Action under v2:** Sonnet self-consistency Jaccard ≥ 0.85 hard gate replaces the retest-disagreement gate entirely. The new gate fires before extractor calibration runs, on a properly-powered 50-scene sample. This retires the protocol drift by design.

---

## What this means for the planner

**Shipped (live in harness):**
- character-arcs (commit `4ec5d8b`): LTWN + arc_resolution enum on `characterProfileSchema`; `planning-plotter/context.ts` renders the arc block; `character-profile-system.md` documents the structure + distribution targets (≥1 tragic_inversion, ≤50% fulfilled for a 5–8 character cast).

**Ship soon (post-design-commit):**
- mckee-gap binary "gap density" prior — a per-beat soft prior into `planning-beats/beat-expansion-system.md` per `docs/structural-dims-to-harness-mapping.md` §4: "Crystal Shard target: > 60% of beats carry a gap; pure 'no gap' beats should not run more than 2 consecutive."

**Hold for v2 re-calibration:**
- mice: 4 parallel binary sub-calls per scene (target P ≥ 0.78 under v2 measurement plan).
- value-charge per-scene polarity / lifeValue: Sonnet-anchored re-calibration with retest expansion to retire NULL-GOLD verdict (binary signal already strong).
- mckee-gap per-field `gap_size` and `gap_type` enums: Sonnet-anchored re-calibration to test enum agreement lift.

**Re-scope under v2:**
- promise: split into `arc-promise` (close ≥5 chapters out) + `setup-payoff-bridge` (close ≤3 chapters out). Each sub-dim has tighter rubric latitude than monolithic "promise."

See `docs/designs/decomposed-extractor-sonnet-anchor-v1.md` for the v2 measurement plan and decision rationale.

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

### Step 7: Phase B (Pro promise extractor) — partial fix, exposes second ceiling

**Question:** Is V4 Pro at extraction time the fix for promise's CELL FAIL? Phase A told us Flash literally can't emit the 2-pass schema; can Pro extractor close the recall gap to Pro judge's 30 promises?

**Methodology:** Run `extract-structure.ts --extractor-model=pro` on the full 858-beat corpus. This routes the promise extractor through `structure-promise-judge` agent (V4 Pro thinking-on, T=0.3, 32K maxTokens) — same role config the Pro judge uses. Compare the Pro-extracted promises against the existing Pro judge gold.

**Cost:** $0.31 ($0.15 pass-1 + $0.17 pass-2). Two V4 Pro thinking calls, 73K input tokens each (32K cached on pass-1).

**Results:**

| Test | Promises found | Matched | P | R | F1 |
|---|---|---|---|---|---|
| Flash extractor | 14 | 9 | 0.64 | **0.30** | 0.41 |
| Pro extractor (Phase B) | 22 | 14 | 0.64 | **0.47** | 0.54 |
| Pro judge (gold) | 30 | — | — | — | — |

**Conclusion (Phase B):** Pro extractor improves recall by **+17pp** (0.30 → 0.47) and finds **+57% more promises** (14 → 22) than Flash. F1 rises from 0.41 → 0.54 (+13pp). The capability gradient is real and substantial.

**But the verdict is still CELL FAIL** — even Pro extractor misses **53% of the Pro JUDGE's promises**, despite using identical role config, identical prompts, identical beats. This is the load-bearing surprise of Phase B:

**Same model, same prompt, same input → different outputs.** Pro extractor at T=0.3 is **non-deterministic at the ~30% level**. Running V4 Pro twice on the same task with the same prompt produces different promise lists. The promise dim has TWO compounding ceilings:

1. **Capability ceiling**: Flash extractor finds only 30% recall — solved by Pro extractor (47% recall).
2. **Stochasticity ceiling**: Pro extractor finds 47% recall while Pro judge (also Pro at T=0.3, same task) finds full 100% — the gap is run-to-run variance, not capability.

**Cost+quality lever for promise specifically:**

| Strategy | Cost/book | Expected recall | Status |
|---|---|---|---|
| Flash extractor (current) | ~$0.01 | 0.30 | CELL FAIL — capability bound |
| Pro extractor T=0.3 (Phase B) | ~$0.30 | 0.47 | CELL FAIL — stochasticity bound |
| Pro extractor T=0 (next) | ~$0.30 | TBD | Hypothesis: recovers most variance loss |
| Pro extractor + 3-run ensemble | ~$0.90 | TBD | Hypothesis: union approaches Pro-judge gold |
| Sonnet/Codex Tier 3 judge | ~$2-5 | TBD | Establishes more rigorous ground truth |

**Action:**

1. **Test Pro extractor T=0** as the cheapest next experiment. Fork `structure-promise-judge` to a `structure-promise-extract-deterministic` role with `temperature: 0`. Re-run Phase B with that role. Cost ~$0.30. If recall jumps to 0.65+, ship it.

2. If T=0 doesn't close the gap, **ensemble approach**: run Pro extractor 3× at T=0.3, take the union of promise lists, deduplicate via the same V4 Pro pair-matcher we built for calibration. Cost ~$1/book. Higher recall guaranteed by union; precision protected by the matcher.

3. **Treat the Pro judge gold as itself uncertain.** The judge is also at T=0.3. Re-running the judge would also give a different 30-promise list. The current "gold" is actually one stochastic sample, not absolute truth. **For the promise dim specifically, we may need a Tier 3 judge (Sonnet/Codex) to anchor a stable gold.** Phase A already showed Flash can't be the judge; Phase B shows Pro at T=0.3 isn't a stable judge either.

4. **Hold off on shipping a promise registry as a planner constraint until one of the above paths gets us past F1=0.70 OR we explicitly redefine the dim's "PASS" floor for stochastic schemas.**

**Skipping the (Pro extractor, Flash judge) cell**: not load-bearing for any decision now. Flash judge can't reliably emit promise schema (Phase A FAIL). The 2×2 matrix has 3 measured cells + 1 known-unmeasurable.

---

### Step 8: Phase C — temperature, ensemble, and Tier 3 experiments

**Motivation:** Phase B revealed that the promise dim has TWO ceilings (capability + stochasticity). Phase C tests four hypotheses to determine which lever to pull, and exposes an important meta-question: **is the Pro judge itself a stable ground truth?**

**Standing rule for this section:** every experiment writes its hypothesis FIRST, then methodology, then results, then conclusion + action. No reverse-engineering hypotheses to fit results.

#### C.1 — Sonnet Tier 3 ground truth on promise

**Hypothesis:** Sonnet (Anthropic) is an independent model family from DeepSeek; if Sonnet's promise list overlaps highly with V4 Pro judge's (say 75%+ shared), that validates Pro judge as ground truth and the extractor recall problem is real. If Sonnet finds a quite different shape (different count, low overlap), Pro judge is itself a noisy signal and our entire calibration framework needs Tier 3 anchoring.

**Methodology:** Spawn a Sonnet subagent with the same promise extraction prompt and same beats. Get a promise list. Use the V4 Pro pair-matcher to compute overlap with both Pro extractor (22 promises) and Pro judge gold (30 promises). Single Sonnet call.

**Status:** in flight (Round 1 parallel).

**Expected outcome:** Either confirms Pro judge as defensible gold OR motivates Tier 3 anchoring as standard practice for stochastic-schema dims (promise specifically).

#### C.2 — Pro judge self-consistency

**Hypothesis:** Pro at T=0.3 has ~30% run-to-run variance (revealed by Phase B). Re-running the Pro judge on the same prompts should produce a different 30-promise list. If gold_v1 vs gold_v2 agreement is low (under 0.85), the "gold" is itself a stochastic sample, not a stable target. Our extractor calibrations are unfairly penalizing Pro extractor for missing promises that the judge finds *only on this particular run*.

**Methodology:** Re-run llm-judge.ts for promise. Generate `promise-gold.v2.jsonl`. Use V4 Pro pair-matcher to compare to existing `promise-gold.jsonl`. Compute matched/unmatched.

**Status:** queued.

**Expected outcome:** Establishes whether the "Pro gold" we've been calibrating against is genuinely fixed or run-dependent. If matched < 0.85, the entire promise calibration needs to switch to ensemble or T=0 gold.

#### C.3 — Pro promise extractor at T=0

**Hypothesis:** Temperature is the stochasticity lever. T=0 deterministic extraction should produce a more stable promise list, closer to whatever the model's "best" interpretation is. If Pro@T=0 recall vs Pro judge gold rises from 0.47 to 0.65+, temperature is the fix; if it stays around 0.47, the variance is from something else (attention on long context, prompt scaffolding, chapter batching).

**Methodology:** Fork `structure-promise-judge` to a `structure-promise-extract-pro-t0` role with temperature=0. Run extract-structure.ts at T=0 (re-using the --extractor-model=pro path with the new role variant). Compute calibration vs existing Pro judge gold.

**Status:** queued (small code change required).

**Expected outcome:** Either temperature is the lever (PASS path opens) OR there's a deeper architectural issue (attention, batching, prompt length).

#### C.4 — Mice prompt iteration

**Hypothesis:** Mice CELL MARGINAL (P=0.731, just below 0.78 PASS gate) is driven by ambiguous "thread closes" definitions. Sanderson's MICE framework leaves close criteria fuzzy — what counts as "closing" a Milieu thread in a scene that revisits a setting?

**Methodology:** Spawn a Sonnet subagent to draft a sharper mice system prompt with explicit close-criterion examples (4 public-domain illustrations of M/I/C/E thread close, drawn from non-fantasy sources to avoid corpus contamination). Re-extract on Flash with the new prompt. Re-judge with Pro. Re-calibrate.

**Status:** queued.

**Expected outcome:** P rises to 0.78+, F1 to 0.85+. If P rises but recall drops, we've over-corrected and need to reset.

---

## Session 2026-04-29 22:36 UTC — Phase C Round 1 Results

This section is append-only per the standing rule; the C.1–C.4 hypothesis blocks above are not edited. Results below either confirm or invalidate them; supersession is documented inline.

### C.1 result — Sonnet Tier 3 ground truth

**Output:** [`promises.20260429T215322.sonnet.json`](../structure/crystal_shard/promises.20260429T215322.sonnet.json) — 38 promises.

| Source | Count | Notes |
|---|---|---|
| Flash extractor | 14 | Default extractor; clearly under-reads |
| Pro extractor (T=0.3) | 22 | Phase B 2×2 cell |
| Pro judge gold v1 (T=0.3) | 30 | First Pro judge run on prompts |
| Pro judge gold v2 (T=0.3) | 27 | C.2 Pro judge rerun, identical config |
| Sonnet Tier 3 | 38 | Subagent extraction, single call |

Sonnet's 38 promises decompose into 32 satisfied, 3 partially satisfied, and 3 unsatisfied/open within this book. The 3 open ones are clear series hooks (Errtu's century-long revenge vow, the Dendybar/Luskan conspiracy, the drow-house vendetta over Masoj's death) — all paid off in later books, not authorial failures. The Pro judge gold runs caught most of the satisfied promises but missed roughly half the series-hook setups, which is what drives the Sonnet count higher than v1/v2.

**Conclusion:** Sonnet finds promises Pro judge misses, AND finds essentially all the promises Pro judge finds. The qualitative gap is recall: Pro judge under-emits clear authorial-intent series hooks. **Sonnet is a defensible Tier 3 anchor for "exhaustive" promise extraction.**

**Action:** Use Sonnet's 38-promise list as the recall ceiling reference going forward. Pro extractor's 22 promises = 22/38 = 58% of the Sonnet ceiling; that's the real "extractor recall" if Sonnet is taken as ground truth.

### C.2 result — Pro judge self-consistency

**Output:** [`crystal_shard.20260429T223642.v1xv2.json`](crystal_shard.20260429T223642.v1xv2.json) — direct V4 Pro pair-matcher between the two judge gold runs.

| Metric | Value |
|---|---|
| v1 size | 30 |
| v2 size | 27 |
| shared | 14 |
| v1-only | 16 |
| v2-only | 13 |
| Jaccard | **0.326** |
| shared / max(v1, v2) | 0.467 |
| shared / min(v1, v2) | 0.519 |

**Two consecutive Pro judge runs (same model, same prompts, T=0.3) overlap on 14 of 43 unique promises — 47% of the larger run, 52% of the smaller.** v1 has 16 promises that v2 didn't catch. v2 has 13 that v1 missed. This is the **gold-stochasticity ceiling**.

If we treat v1 as gold and v2 as predicted: tp=14, fp=13, fn=16 → **F1 = 0.491**. That's the upper bound on calibration F1 between any Pro extractor and any single Pro judge gold run — because Pro vs Pro at the gold level only achieves F1=0.49.

**Conclusion (invalidates C.2 hypothesis pre-condition):** The hypothesis was "if v1↔v2 < 0.85 the gold is unstable." It's 0.326. The promise gold is **profoundly unstable**. Single-run Pro judge gold cannot serve as a precision/recall reference for the promise dim — the metric is dominated by gold variance, not extractor variance.

**Action:** Ship the **gold-stability ceiling F1 = 0.491** as a metadata field on every promise calibration verdict so future readers know the metric's noise floor. Promote calibration policy to ensemble gold (intersection of N≥3 Pro judge runs, or union for recall-weighted) before re-judging the promise PASS gate. Track in [`docs/todo.md`](../../../docs/todo.md) as a Phase C exit task.

### C.3 result — Pro extractor at T=0

**Outputs:**
- Extraction: [`promises.20260429T221035.pro-t0.json`](../structure/crystal_shard/promises.20260429T221035.pro-t0.json) — 22 promises.
- Calibrations: [`crystal_shard.20260429T222440.pro-t0xv1.json`](crystal_shard.20260429T222440.pro-t0xv1.json) and [`crystal_shard.20260429T222441.pro-t0xv2.json`](crystal_shard.20260429T222441.pro-t0xv2.json).

| Cell | matched | predN | goldN | P | R | **F1** |
|---|---|---|---|---|---|---|
| Pro@T=0.3 vs v1 (Phase B baseline, restated post-fix) | 14 | 22 | 30 | 0.636 | 0.467 | 0.538 |
| Pro@T=0.3 vs v2 | 15 | 22 | 27 | 0.682 | 0.556 | **0.612** |
| Pro@T=0   vs v1 | 16 | 22 | 30 | 0.727 | 0.533 | **0.615** |
| Pro@T=0   vs v2 | 12 | 22 | 27 | 0.545 | 0.444 | 0.490 |

**Pro@T=0 produces the same count (22) as Pro@T=0.3** — temperature did not change the model's output cardinality. F1 against v1 went UP (0.538 → 0.615) but F1 against v2 went DOWN (0.612 → 0.490). The two T=0 calibrations span F1 0.490 → 0.615; the two T=0.3 calibrations span 0.538 → 0.612. The **range across gold versions ≈ 0.12 F1** in either temperature. **The variance is dominated by which gold run you chose, not the extractor temperature.**

The Pro extractor's best F1 (0.615) is **higher than the Pro judge's self-consistency F1 (0.491)** — the extractor matches a particular gold sample as well as another gold sample does. That's the saturation signal.

**Conclusion (partial supersession of C.3 hypothesis):** Hypothesis was "T=0 should fix the extractor stochasticity." The diagnosis was wrong: the stochasticity is on the **judge** side, not the extractor. T=0 mostly preserved the same 22 promises but interacted with which gold they happened to align with. C.3 does not unlock a PASS path.

**Action:** Stop trying to lift extractor F1 in isolation. Switch to ensemble gold (per C.2 action) and re-evaluate every extractor against the ensemble. Likely to find the picture stabilizes substantially under intersection-of-3 gold.

### Cross-cutting: promise dim verdict updated

Pre-Phase C the promise dim was at CELL FAIL with the v1 Pro gold (F1=0.41 reported in Phase A; 0.538 with the matcher fix). The Phase C results re-frame the verdict: **the dim is currently NULL-GOLD-LIKE** — not because adjudicator self-disagreement on retests was high, but because two independent runs of the same judge produce nearly disjoint promise lists. We cannot honestly assert CELL PASS / FAIL until the gold is anchored.

| What is settled | What is not |
|---|---|
| Sonnet 38 ≥ Pro judge 27–30 ≥ Pro extractor 22 ≥ Flash 14 | Whether any extractor beats the gold-stability ceiling |
| Pro extractor matches gold ~as well as gold matches gold | The "true" promise count for crystal_shard |
| Temperature is not the lever | Whether prompt iteration changes things |

**Standing recommendation:** Park the promise dim's PASS/FAIL until ensemble gold lands. Ship the OTHER four dims (value-charge, mice, mckee-gap, character-arcs) on their existing verdicts. Do NOT block corpus expansion on the promise dim.

### C.4 status

Not yet run. Lower priority now that C.1–C.3 closed the temperature/Tier-3 questions. Keep queued for the mice marginal-precision tightening.

### Cost ledger delta this session (Phase C Round 1)

| Step | Calls | Total cost |
|---|---|---|
| C.1 Sonnet Tier 3 (subagent) | 1 | ~$0.00 (subagent path, billed separately) |
| C.2 Pro judge rerun (v2) | 2 | ~$0.30 |
| C.3 Pro@T=0 extraction | 2 | ~$0.30 |
| C.2.a/b/C.3.a/b/v1xv2 calibrations | 5 (after fixes ~8) | ~$0.20 |
| **Phase C round 1 subtotal** | ~12 | **~$0.80** |

Cumulative across all phases on crystal_shard: ~$3.30. Still trivial.

---

## Cost+model conclusions across all phases

| Strategy | F1 (best dim) | F1 (worst dim) | Total cost/book | Recommendation |
|---|---|---|---|---|
| Flash extractor + Flash judge | character-arcs 1.00, promise FAIL | promise FAIL | **~$0.50** | Ship for character-arcs, mice. Cheapest. |
| Flash extractor + Pro judge (current) | character-arcs 1.00, promise 0.41 | promise 0.41 | **~$1.20** | Defensible default. CELL PASS on character-arcs. |
| Pro extractor + Pro judge (Phase B for promise) | promise 0.54 | promise still FAIL | **~$2.50** | Improvement on promise, still not PASS. |

**Conclusion across the 2×2:** for dims with a clean schema (character-arcs, value-charge polarity, mice opens/closes), Flash×Flash is cheapest and reliable. For promise specifically, neither Flash nor Pro at T=0.3 is enough — needs T=0 or ensemble or Tier 3 judge.

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

---

## Session 2026-04-29 23:00 UTC — Phase C Round 2 Results

Round 1 (above) closed the temperature/Tier-3 questions and re-classified promise as NULL-GOLD-LIKE. Round 2 was launched in parallel with the goal of (a) reaching additional conclusions while waiting on mckee-gap full-corpus extraction, (b) unblocking the four non-promise dims with concrete prompt + harness changes, and (c) opening avenues we hadn't explored yet (cardinality pivot, cross-book/cross-author).

Five subagents + one inline analysis ran concurrently. All seven completed; results below.

### R2.1 — McKee-gap full-corpus extraction (V3 rerun)

**Output:** [`mckee-gap.20260429T225927.jsonl`](../structure/crystal_shard/mckee-gap.20260429T225927.jsonl) (824 rows) + [`extract-mckee-gap-summary.20260429T225927.json`](../structure/crystal_shard/extract-mckee-gap-summary.20260429T225927.json). (Files renamed from legacy un-stamped names retroactively — the v3 extractor process kicked off before the stamping refactor landed at commit `2785076`. Data integrity preserved; rename used `extractedAt` from the summary as the canonical stamp.)

| Field | Distribution |
|---|---|
| `gap_size` | none 158 (19%), small 152 (18%), medium 263 (32%), large 248 (30%) |
| `gap_type` | reversal 244 (30%), revelation 183 (22%), undermining 147 (18%), escalation 83 (10%), none 159 (19%), other 5 |
| Coverage | 858 beats total → 824 tagged (34 chapter-openers skipped per design) → 821 ok / 3 fail / 71 abstain |

**Conclusion:** McKee-gap distribution is **not flat** — Salvatore's prose is dominated by `medium`+`large` gaps (62% of beats) and 81% of beats carry SOME gap (none-type only 19%). Among non-zero types, **reversal** (30%) and **revelation** (22%) lead — consistent with Salvatore's action-pulp pattern (a beat sets up an expectation; the next page upends or upgrades it). This is the first numerically-explicit corpus-derived planner constraint for tension cadence.

**Action:** Calibration sample + Pro judge in flight (separate task). Verdict pending; if F1 ≥ 0.70 on `gap_size` binary (none vs any-gap), ship as soft prior in `planning-beats/beat-expansion-system.md` per the harness mapping (R2.5).

### R2.2 — Promise cardinality pivot

**Hypothesis:** discrete-set Jaccard (0.326 v1↔v2) may be unfairly punishing — the task is gold-text-fragile but per-chapter open-DENSITY profile might be stable. If chapter-2 universally gets 3-5 promise opens and chapter-6 universally gets 0, the planner-relevant signal (where in the book opens cluster) could be load-bearing even when the specific promise lists differ.

**Methodology:** [`scripts/corpus/cardinality.ts`](../../../scripts/corpus/cardinality.ts) loads all six promise sources, tabulates per-chapter open/close counts and span distributions, and computes pairwise per-chapter-opens correlation across all 6 sources.

**Output:** [`crystal_shard.20260429T230455.cardinality.json`](crystal_shard.20260429T230455.cardinality.json) and [`crystal_shard.20260429T225549.cardinality.json`](crystal_shard.20260429T225549.cardinality.json).

**Per-chapter opens correlation matrix (Pearson):**

| | Flash | Pro@T=0.3 | Pro@T=0 | Gold v1 | Gold v2 | Sonnet |
|---|---|---|---|---|---|---|
| Flash | 1.000 | 0.505 | 0.343 | 0.335 | 0.549 | 0.604 |
| Pro@T=0.3 | 0.505 | 1.000 | 0.678 | 0.552 | 0.555 | 0.466 |
| Pro@T=0 | 0.343 | 0.678 | 1.000 | **0.742** | 0.465 | 0.184 |
| Gold v1 | 0.335 | 0.552 | **0.742** | 1.000 | **0.447** | 0.307 |
| Gold v2 | 0.549 | 0.555 | 0.465 | **0.447** | 1.000 | 0.380 |
| Sonnet | 0.604 | 0.466 | 0.184 | 0.307 | 0.380 | 1.000 |

**Span distribution comparison:**

| Source | n | mean | median | same-ch | 1-3 | 4-8 | 9+ |
|---|---|---|---|---|---|---|---|
| Flash | 14 | 148.7 | 6 | 3 | 4 | 1 | 6 |
| Pro@T=0.3 | 22 | 139.5 | 3 | 7 | 5 | 2 | 8 |
| Pro@T=0 | 18 | 59.3 | 3 | 4 | 5 | 4 | 4 |
| **Gold v1** | 30 | **104.0** | 5 | 8 | 6 | 7 | 9 |
| **Gold v2** | 23 | **4.0** | 0 | **15** | 2 | 1 | 5 |
| Sonnet | 35 | 121.1 | 11 | 4 | 6 | 5 | 19 |

**Conclusions:**

1. **Cardinality is partially stabler than discrete-set Jaccard, but not enough to save the dim.** Gold v1 ↔ Gold v2 per-chapter-opens correlation is 0.447, vs discrete-set Jaccard 0.326 — a small lift but the same magnitude of instability. Both signals are dominated by the SAME judge stochasticity.

2. **Pro@T=0 ↔ Pro judge gold v1 correlation is 0.742** — the strongest pair. T=0 extraction aligns most closely with whichever specific gold sample happened to fix that side of the calibration. This is consistent with the C.3 finding (extractor stochasticity is small; judge stochasticity dominates).

3. **Gold v2's span distribution is structurally different from gold v1.** Same model, same prompts, T=0.3 — but v1 has mean=104 (dominated by series-hook far-payoff promises) while v2 has mean=4 with median 0 (dominated by within-chapter setup-payoffs). **The judge is not just choosing different promises run-to-run; it is choosing different STRUCTURAL DEFINITIONS of "what counts as a promise."** Two valid reads of the rubric: "I'm tracking arc-spanning threats" (v1) vs "I'm tracking small Chekhov bridges" (v2). This is the underlying engine of the gold-stochasticity ceiling.

4. **Stable structural facts ARE present at the macro level.** Six chapters universally empty across all 6 sources (ch6, ch14, ch18); chapter 2 universally dense (3-5 opens). These are real corpus-level signals robust to judge variance — but they are too coarse to feed into a per-beat planner prompt directly.

**Action:** Cardinality alone does not resolve the promise dim. Promotes a different lever: **promise-rubric specification.** The judge isn't unstable because of temperature or model variance; it's unstable because the rubric admits two structurally different interpretations. Ensemble gold won't fix this — the two definitions don't intersect well. The real fix is **prompt-level disambiguation**: split "promise" into two sub-dims (arc-promise + setup-payoff bridge) with separate rubrics, or pick one and exclude the other. Tracked as new Phase C exit task.

### R2.3 — Sonnet pair-matcher confirms v1↔v2 gold instability

**Hypothesis (Round 1 follow-up):** Round 1's v1↔v2 Jaccard of 0.326 was computed via the V4 Pro pair-matcher. If Pro itself is stochastic, the matcher could be UNDER-matching (false-rejecting paraphrases). A Sonnet pair-matcher (different model family) gives a second independent measurement of the same overlap.

**Methodology:** Sonnet subagent re-ran the V4 Pro pair-matcher logic on the same v1 and v2 promise lists with the same chapter-window±1 constraint and 1:1 matching rule.

**Result:** Sonnet pair-matcher returned **15 shared** (vs Pro's 14 shared, Δ=1). Jaccard = 15 / (30 + 27 − 15) = **0.357** (vs Pro's 0.326, Δ=+3pp).

**Conclusion:** The gold instability is REAL, not an artifact of conservative pair-matching. Two independent models (V4 Pro, Sonnet) agree within 1 promise on the v1↔v2 overlap. The shared / max(v1,v2) ratio is ~0.50 either way — only half the promises in the larger gold list appear in the smaller.

**Action:** Pair-matcher choice no longer load-bearing. The discrete-set ceiling holds. Re-confirms R2.2's conclusion: the instability lives in the rubric itself, not the matcher.

### R2.4 — Mice prompt v2 (close-criterion sharpening)

**Hypothesis (C.4):** Mice CELL MARGINAL P=0.731 is driven by ambiguous "thread close" definitions. If we add explicit hard close-criteria (M = depart + obligation resolved + spatial question answered; I = answer delivered, not hypothesis formed; C = decisive choice + narrative treats as completion; E = new stable status quo) plus 4 public-domain worked examples (Conan Doyle / Austen / Twain / Verne), Flash should be more conservative on `closes_thread = true` and lift P to ≥0.78.

**Output:** [`src/agents/structure-mice/mice-system-v2-draft.md`](../../../src/agents/structure-mice/mice-system-v2-draft.md) — 237 lines (vs v1's 175).

**Key changes:**
- New "CLOSE CRITERIA — read before tagging any closes_thread = true" section, with 4 hard-rule subsections (one per thread type).
- 4 public-domain worked examples WITH counter-examples (Hound of the Baskervilles for M; P&P for I; Huck Finn for C; Around the World in 80 Days for E).
- New M-vs-E tie-break rule (default M as primary, E as secondary).
- Confidence calibration table preserved from v1.
- "Hard rules" expanded from 6 to 7 (added explicit close-criterion gate).

**Status:** Draft; not yet routed to the Flash extractor. Calibration re-run (extract → Pro judge → compute) deferred until after the harness-prompt commit lands so the v2 prompt becomes the canonical mice-system.md.

**Action:** Ship the draft as the canonical prompt in the same commit as Round 2 work. Re-extract on the new prompt + re-judge + re-calibrate as a follow-up cycle. Target: P ≥ 0.78. Risk noted in subagent output: over-correction may drop recall — if R drops > 5pp without P rising > 5pp, revert v2 and iterate again.

### R2.5 — Value-charge prompt v2 (3-step lattice + commit-to-sign)

**Hypothesis:** Value-charge NULL-GOLD verdict is driven partly by sample-size (n=5 retest) but also by Flash defaulting to `polarity = 0` for genuinely-shifted scenes that are subjectively ambiguous. If the prompt provides an explicit 3-step internal scale (+1 / 0 / -1) and a "commit to + or − first; 0 is fallback of last resort" instruction, Flash should reduce false-`0` calls and lift the per-scene polarity agreement.

**Output:** [`src/agents/structure-value-charge/value-charge-system-v2-draft.md`](../../../src/agents/structure-value-charge/value-charge-system-v2-draft.md) — 179 lines (vs v1's 67).

**Key changes:**
- New "POLARITY CRITERION" section with the 3-step internal scale and the explicit "commit to ± first" rule.
- 4 worked examples drawn from public-domain canon (Conan Doyle's *Scandal in Bohemia* for hope-despair `+`, Verne for freedom-slavery `−`, Austen for `0` rare-case, Stoker for `0→−` final-position rule).
- "Circumstance shift = value shift" hard rule — when external facts change (gained ally, lost ally), do not flatten to `0` based on internal-state ambiguity.
- "Cliffhangers are NOT automatically `0`" rule — measure entry-to-exit on the in-scene axis, not on meta-narrative resolution status.
- Polarity values restricted to `+ | - | 0` only (no `mixed` — confirmed via existing schema).

**Status:** Draft; not yet routed.

**Action:** Ship the draft. Re-extract + re-judge with retest pool n ≥ 20 (currently n=5) to retire the NULL-GOLD verdict. Target: Flash×Pro polarity agreement ≥ 0.80 (was 0.76). Combined with the larger retest, this should land CELL PASS.

### R2.6 — Harness prompt-injection mapping

**Output:** [`docs/structural-dims-to-harness-mapping.md`](../../../docs/structural-dims-to-harness-mapping.md) — concrete file/line/schema injection plan per dim.

**Per-dim mapping summary:**

| Dim | Status | Site | Constraint | Effort |
|---|---|---|---|---|
| character-arcs | **CELL PASS** — ship now | `src/agents/character-agent/context.ts:30` + `schema.ts` | Hard schema (LTWN + arc_resolution enum) | 1 commit, 0 planner changes |
| mice | MARGINAL — hold for v2 prompt | `src/schemas/shared.ts` (sceneBeatSchema) + `planning-beats/beat-expansion-system.md` | Soft prior (per-beat optional) | 1 commit after C.4 lands |
| value-charge | NULL-GOLD — hold for retest | same as mice | Soft prior (per-beat optional) | 1 commit after retest expand |
| mckee-gap | TBD — pending calibration | same as mice | Soft prior (per-beat optional) | 1 commit after verdict |
| promise | NULL-GOLD-LIKE — parked | `plotter/story-structure-system.md` + existing `requiredPayoffs` | Park until rubric-disambiguation | 0 commits now |

**Key insight from the mapping:** `requiredPayoffs` already exists on `sceneBeatSchema` and handles intra-chapter setup-payoffs. We do NOT need a new beat-level promise mechanism — only a chapter/act-level promise registry, which depends on the (parked) promise dim. **The other four dims share a single injection target:** `sceneBeatSchema` in `src/schemas/shared.ts` + the Phase-2 `beat-expansion-system.md` prompt. One schema PR can carry mice + value-charge + mckee-gap as optional fields, gated by their respective verdicts.

**Action:** Ship character-arcs first (hard constraint, immediate). Cluster the other three into a single `sceneBeatSchema` extension PR once their individual verdicts land.

### R2.7 — Cross-book + cross-author brief

**Output:** [`docs/cross-book-cross-author-brief.md`](../../../docs/cross-book-cross-author-brief.md).

**Recommendation:** Run **Streams of Silver** (2nd Salvatore book, 104K words, already on disk and in the bundle config) FIRST to test author-stability of the crystal_shard distributions. Then run **Jim Butcher's Storm Front** (Dresden Files #1, 90K, urban fantasy, first-person POV) as the cross-author probe.

**Rationale (concise):**
- Streams of Silver Stage 1-5 already done at the trilogy level; only `normalize-for-structure --book streams_of_silver` is required before Stage 6. Sub-second prep, $2-3 LLM cost. Validates whether crystal_shard's distributions are author-fingerprint or single-book artifact.
- Storm Front's first-person POV stress-tests character-arc extractor's F1=1.00. Series structure stress-tests promise (parked) but provides a second data point. ~$15 acquisition + ~$2 extraction. Mistborn rejected (3× cost, 4-act structure confounds comparison); Robertson Breakers rejected (genre-too-distant).

**Combined timeline:** ~12-14h wall-clock, ~3h author oversight, ~$18-20 LLM cost at promo (saves ~$15 vs post-promo).

**Risks flagged:** (a) Promise dim should be skipped on both new books until ensemble gold ships; (b) Streams of Silver scene-break count is only 47 (vs 105 for crystal_shard) — verify breaks before extractors; (c) Storm Front first-person POV may degrade character-arc F1 — budget one prompt iteration if MARGINAL.

**Action:** Park as scheduled work. Do NOT block on it. Land character-arcs harness integration first. **All current Crystal Shard distributions are book-scoped, not author-scoped or genre-scoped** — the "Salvatore fingerprint" framing is premature until at least one cross-book sample lands. If F1=1.00 holds on Streams of Silver, character-arc reliability promotes from book-scoped to author-scoped (one author, two books). A genre-level claim sufficient to ship `WRITER_GENRE_PACKS["fantasy"]` with the LTWN distribution as a hard prior requires at least the Storm Front cross-author run to also pass.

### Updated decision matrix (post-Round 2)

| Dim | Round 1 verdict | Round 2 verdict | Next move |
|---|---|---|---|
| character-arcs | CELL PASS | CELL PASS (unchanged) | **Ship harness integration NOW** (LTWN + arc_resolution enum on `characterProfileSchema`) |
| mice | CELL MARGINAL P=0.731 | v2 prompt drafted | Re-extract on v2 → re-judge → re-calibrate; target P ≥ 0.78 |
| value-charge | NULL-GOLD (n=5 underpowered) | v2 prompt drafted | Re-extract on v2 → expand retest n ≥ 20; target CELL PASS |
| mckee-gap | extraction in flight | full corpus done; calibration in flight | When judge completes, compute calibration; ship soft prior if F1 ≥ 0.70 |
| promise | NULL-GOLD-LIKE | confirmed by Sonnet pair-matcher + cardinality | **Re-scope dim into arc-promise + setup-payoff sub-dims**; park current rubric |

### New avenues opened by Round 2

1. **Promise rubric disambiguation as the real lever** — not temperature, not ensemble, not Tier 3. The judge produces two structurally different interpretations of the same prompt at T=0.3. Splitting the rubric is a separate research task, NOT blocking the other four dims.

2. **Single-PR schema injection for mice/value-charge/mckee-gap** — the harness mapping shows all three can share `sceneBeatSchema` extensions. We can land the schema scaffolding now (with all three fields optional) and gate the prompt-level activation per-verdict.

3. **Cross-book / cross-author distinction is a real architectural fork** — author-stable distributions justify the per-`WRITER_GENRE_PACKS` granularity; genre-stable distributions imply we collapse to genre-level priors. Streams of Silver answers this in ~$3 + 30 min if we prioritize.

4. **Macro-level promise structure IS extractable** — chapters 6/14/18 universally empty, chapter 2 universally dense (every source agrees). A chapter-density planner constraint ("chapter 2 should host 3+ promise opens; chapters 6/14/18 should not introduce new arcs") is shippable from the macro-level cardinality data even if the per-promise list is unstable. Lower-priority but unblocked.

### Cost ledger delta (Phase C Round 2)

| Step | Calls | Total cost |
|---|---|---|
| McKee-gap full corpus extraction (V3 rerun) | 824 | ~$0.25 (Flash) |
| Cardinality analysis (no LLM) | 0 | $0.00 |
| Sonnet pair-matcher subagent | 1 | subagent (separate billing) |
| Mice / value-charge prompt drafts (subagent) | 0 LLM in repo | subagent |
| Harness mapping doc (subagent) | 0 LLM | subagent |
| Cross-book brief (subagent) | 0 LLM | subagent |
| McKee-gap calibration (sample + Pro judge, in flight) | 55 | ~$0.30 (est) |
| **Phase C round 2 subtotal** | ~880 | **~$0.55** |

Cumulative on crystal_shard: ~$3.85. Trivially affordable.

---

## Session 2026-04-29 23:44 UTC — McKee-gap v1 verdict (Phase C v1 close-out)

McKee-gap calibration completed under v1 architecture (Flash extractor × Pro judge). Closes the v1 phase of Phase C; v2 (decomposed + Sonnet anchor) is documented in the next section.

**Output:** [`crystal_shard.20260429T234411.json`](crystal_shard.20260429T234411.json) — full metrics + verdict.

### Verdict — CELL PASS

| Metric | Value | Threshold | Status |
|---|---|---|---|
| n (sample) | 52 (of 55; 3 judge failures) | — | sufficient |
| Precision | **0.925** | ≥ 0.78 | PASS |
| Recall | **0.860** | ≥ 0.65 | PASS |
| F1 | **0.892** | ≥ 0.78 | PASS |
| gap_size per-field agreement | 0.577 (30/52) | ≥ 0.78 | **below** |
| gap_type per-field agreement | 0.558 (29/52) | ≥ 0.78 | **below** |
| Retest self-disagreement | 0.40 (2/5) | ≤ 0.15 | **above** (n=5 underpowered) |

**Reading the verdict carefully — and flagging protocol drift.** F1=0.892 is on the **binary "did the judge call any gap"** question — strong agreement on whether a beat carries a gap-of-some-kind. The per-field enums (gap_size 4-class and gap_type 6-class) are below the PASS gate; these are the fields the planner consumes. Retest self-disagreement is 40% but on n=5 — that's an **underpowered pool**, not statistical noise that resolved one way or the other. **Value-charge had the identical signal (40% on n=5) and posted NULL-GOLD; this dim posted CELL PASS.** The protocol drift is documented in the front-matter "Verdict-protocol note." Under v2 the n=5 retest gate is replaced by a Sonnet self-consistency Jaccard ≥ 0.85 gate on a properly-powered 50-scene sample; the inconsistency retires by design.

This is structurally the same shape as **value-charge** Phase A:
- value-charge binary F1=0.94, polarity-shift agreement 0.76, lifeValue agreement 0.56
- mckee-gap binary F1=0.89, gap_size agreement 0.58, gap_type agreement 0.56

In both dims: load-bearing binary signal is strong; multi-class enum agreements are borderline. Both share the same architectural pressure — a single Flash call deciding multi-class enum without explicit category-criterion constraints.

### Conclusion + Action

**Ship status:**
- **Binary "gap or no gap"** — shippable as a planner constraint immediately. 81% of beats in Crystal Shard carry SOME gap (corpus-level finding from R2.1); F1=0.89 cross-model is enough to feed this into the planner as a target distribution.
- **`gap_size` and `gap_type` enums** — HOLD until v2 re-calibration. Likely lift under the decomposed + Sonnet-anchor architecture (the v2 design doc explicitly calls out mckee-gap retains single-call shape but anchors against Sonnet).

**Action:** mckee-gap binary distribution can flow into the harness mapping (per `docs/structural-dims-to-harness-mapping.md` §4) as a per-beat soft prior — "Crystal Shard target: > 60% of beats carry a gap." The full `gap_size`/`gap_type` shape ships only when v2 re-calibration lands.

### Updated front-matter verdict table (final v1 row)

| Dim | Verdict | Notes |
|---|---|---|
| value-charge | NULL-GOLD (verdict-gate artifact) → expected CELL PASS post-v2 | Per-scene polarity 0.76, lifeValue 0.56 (planner-relevant); binary F1=0.94. n=5 retest underpowered, tripped NULL-GOLD verdict gate. |
| promise | NULL-GOLD-LIKE | Gold v1↔v2 Jaccard 0.326 (Sonnet pair-matcher confirms 0.357); rubric-latitude problem; v2 splits into `arc-promise` + `setup-payoff-bridge` |
| **character-arcs** | **CELL PASS — SHIPPED** | Character ID F1=1.00 (load-bearing field); arc_resolution agreement 0.67. Live in harness commit `4ec5d8b` |
| mice | CELL MARGINAL | Primary_thread + opens/closes F1=0.776, P=0.731 (planner-relevant); v2 decomposes into 4 parallel binary calls per scene |
| **mckee-gap** | **CELL PASS (binary only)** | gap_size agreement 0.58, gap_type 0.56 (planner-relevant, both below gate); binary F1=0.892, P=0.925, R=0.860. v2 single-call retained, Sonnet anchor expected to lift enums |

**Aggregated v1 verdict:** SCOPED PASS — character-arcs (shipped) + mckee-gap (binary, holding for v2 enum lift) + value-charge (binary, holding for retest expansion); promise + mice need v2 architecture.

### Cost ledger delta (Phase C v1 close-out)

| Step | Calls | Cost |
|---|---|---|
| McKee-gap sample-for-adjudication | 0 (deterministic) | $0.00 |
| McKee-gap Pro judge (55 prompts, 52 ok / 3 fail) | 55 | ~$0.30 (matches estimate) |
| McKee-gap calibration | 0 (post-fix) | $0.00 |
| **v1 close-out subtotal** | 55 | **~$0.30** |

Cumulative on crystal_shard under v1 architecture: **~$4.15**. Final v1 spend.

---

## Session 2026-04-29 ~23:30 UTC — Architectural pivot to v2 (decomposed extractor + Sonnet anchor)

The Round 2 findings (gold stochasticity ceiling on promise; mice CELL MARGINAL on cognitive load; cross-model dim agreement only matters when the rubric admits one interpretation) generalize into a single architectural pivot. Captured as a draft design doc and decision-record entry; this section in the conclusions doc records the calibration-side context for that pivot.

### What we're changing

| Layer | v1 (Phase A/B/C above) | v2 (going forward) |
|---|---|---|
| Extractor — mice | One Flash call per scene: 4-way classification + opens/closes + secondary + descriptor + quote | 4 parallel binary Flash calls per scene (one per M/I/C/E thread type), each emitting `{is_dominant, opens, closes}` |
| Extractor — promise | One Flash/Pro call → free-text descriptor + (open_ch, close_ch) | Two sub-dims: `arc-promise` (close ≥ 5 chapters out) + `setup-payoff-bridge` (close ≤ 3 chapters out), each its own extractor + anchor |
| Extractor — value-charge | One Flash call (already enum-shaped on every load-bearing field) | UNCHANGED on prompt shape; v2 prompt draft's 3-step lattice + commit-to-sign absorbs in for the next re-calibration |
| Extractor — mckee-gap | One Flash call (enum on `gap_size` and `gap_type`) | UNCHANGED |
| Extractor — character-arcs | One Flash call (closed cast + LTWN + arc_resolution enum) | UNCHANGED — already shipped (CELL PASS, commit `4ec5d8b`) |
| Calibration anchor | V4 Pro judge (~$0.30–1.50/book/dim) | Sonnet one-shot oracle on a 50-scene sample (~$0.50–1.50/book/dim) |
| Pre-flight | None — calibration ran straight through | **Sonnet self-consistency Jaccard ≥ 0.85 hard gate per dim before extractor calibration** |

### Why the pivot

Two findings from Phase C (above) compose:

1. **Mice CELL MARGINAL** = cognitive load problem. Same shape as the 2026-04-08 adherence-checker fix (memory `feedback_decompose_checker_calls.md`).
2. **Promise NULL-GOLD-LIKE** = rubric-latitude problem. Free-text promise descriptors admit two structurally different interpretations of "promise" (arc-spanning threats vs within-chapter Chekhov bridges). Same model + same prompt + multiple defensible interpretations → unstable gold (memory `feedback_gold_stability_first.md`).

Both are rubric-latitude problems at different layers. Decomposition tightens cognitive latitude; sub-dim splitting tightens semantic latitude. Sonnet anchor replaces a same-family judge (Pro shares biases with Flash) with an independent-family ground truth that was already validated as a higher-recall oracle in C.1 (Sonnet 38 promises vs Pro's 27-30, nearly-all-superset).

### Why we documented it as a pivot, not just a "next iteration"

Three reasons:

- **It supersedes the v2 prompt drafts** (`mice-system-v2-draft.md`, `value-charge-system-v2-draft.md`) as the destination architecture. The drafts become source material for sub-prompts, not canonical prompts.
- **It changes the calibration shape** for every future corpus run (Streams of Silver, Storm Front). Cross-book validation should run under v2 from the start, not v1.
- **It changes the cost profile** ~5-10× per book ($2.50 → $14-27 at promo pricing). Worth recording explicitly so future readers understand why corpus runs got expensive.

### Per-dim re-calibration cost projection (v2)

| Dim | Sonnet stability check (50 × 2) | Decomposed Flash extraction | Sonnet anchor (50 × 1) | Total |
|---|---|---|---|---|
| mice (4 sub-calls) | $1–3 | $1–2 | $0.50–1.50 | $2.50–6.50 |
| arc-promise | $0.50–1.50 | $0.30–0.60 | $0.25–0.75 | $1–3 |
| setup-payoff-bridge | $0.50–1.50 | $0.30–0.60 | $0.25–0.75 | $1–3 |
| value-charge | $1–2 | $0.30–0.60 | $0.50–1.00 | $2–4 |
| mckee-gap | $1–2 | $0.30–0.60 | $0.50–1.00 | $2–4 |
| **Total per book** | **$4–10** | **$2.20–4.40** | **$2–5** | **$8.50–20.50** |

Crystal Shard rerun under v2: ~$10–15 incremental cost on top of the ~$3.85 already spent under v1. Total Crystal Shard reference cost would be ~$15–20 — still trivially affordable for a fully-validated reference book.

### Pass criteria per dim under v2

A dim ships its v2 verdict when **both**:

1. **Sonnet self-consistency Jaccard ≥ 0.85** on the 50-scene sample (anchor is stable).
2. **Flash × Sonnet F1 ≥ 0.78** AND ≥ 5pp improvement over the v1 Flash×Pro baseline (or ≥ 0.78 absolute for new sub-dims like arc-promise / setup-payoff-bridge).

If anchor stability fails (< 0.70 Jaccard), the sub-dim is re-scoped before any extractor calibration. If anchor stable but F1 low, decompose further or sharpen sub-rubric.

### Implementation order (post-McKee-gap close-out)

1. McKee-gap v1 calibration completes (Pro judge in flight). Verdict appended to this doc as Round 2 close-out.
2. v1 Phase C is committed and frozen as the baseline. Adversary review (Codex `codex-rescue gpt-5.5 effort=high`) on the v2 design doc against the v1 baseline.
3. Gate 1 — Sonnet self-consistency on the 4 modified dims. ~$8–15. Half-day wall-clock with subagent path. Per-dim go/no-go gate.
4. Gate 2 — Sub-prompt drafts for dims that pass Gate 1.
5. Gate 3 — Flash extraction under v2 + Sonnet anchor calibration. Per-dim verdicts.
6. Cross-book runs (Streams of Silver, Storm Front) start under v2.

### What is NOT changing

- **Character-arcs is shipped under v1.** F1=1.00 character identification + LTWN. No architectural pressure to re-touch. A future Sonnet-anchored validation is on the table when convenient (Open Question #4 in the design doc) but not blocking.
- **Pipeline scripts (extract-structure.ts, llm-judge.ts, etc.).** v2 is an architecture shift, not a tooling rewrite. Same `_run-stamp.ts` / no-overwrite convention. Same `compute-calibration.ts` shape. New per-dim sub-prompts; new model role for Sonnet-anchor calls; same pipeline runner.
- **The v1 verdict numbers in the front-matter table.** They stay as the v1 baseline. v2 verdicts will be appended as a separate row in each per-dim verdict table.

### Linked context

- Design doc: [`docs/designs/decomposed-extractor-sonnet-anchor-v1.md`](../../../docs/designs/decomposed-extractor-sonnet-anchor-v1.md)
- Decision record: `docs/decisions.md` "Corpus structural-decomposition v2 — decomposed extractor + Sonnet anchor"
- Source rubric material: `src/agents/structure-mice/mice-system-v2-draft.md` + `src/agents/structure-value-charge/value-charge-system-v2-draft.md` (absorbed, not promoted)

---

## Session 2026-04-30 00:21 UTC — Cheapest-counterfactual mice test (Codex pivot validation)

Both Codex reviews of the v2 design converged on the same recommendation: **before committing to the 4-binary-call mice decomposition + the broader v2 architecture, run the cheapest counterfactual** — monolithic Flash × Sonnet anchor on a frozen sample, with two Sonnet runs to measure anchor self-consistency. Memory `feedback_codex_counterfactual_signal` standing rule: when Codex returns RED with a named cheapest-untried-counterfactual, treat it as a pivot recommendation, not an alternative to refute.

**Per the user direction: Sonnet runs use Claude Code subagents, not API calls** (memory `feedback_sonnet_subagents`). 8 subagents total: 4 batches × 2 runs. Total wall-clock ~3 minutes (subagents ran in parallel).

### Hypothesis

If Sonnet's self-consistency on the existing monolithic mice rubric is **≥0.85 Jaccard on `primary_thread`** AND Flash × Sonnet F1 ≥ 0.78 on the binary "thread fired" call, the v2 4-binary-call decomposition is unnecessary. Ship the monolithic shape with a Sonnet anchor.

If anchor stability is `< 0.70`, the rubric is too latitude-permissive to anchor against — the same problem we identified for promise (R2.2/R2.3), now suspected for mice. Re-scope before any extractor calibration.

If F1 ≥ 0.78 but stability is borderline, the architecture question is genuinely open and needs a larger sample to resolve.

### Methodology

Sample: **30 unique scenes** from the existing mice sample (the original adjudication sample contained 33 rows but 3 duplicate `scene_id`s; deduping leaves 30 distinct scenes). Output written to `/tmp/sonnet-mice-test/run{1,2}-batch-{1,2,3,4}.jsonl`.

Each subagent received:
- The current monolithic mice rubric (`src/agents/structure-mice/mice-system.md`, 175 lines, untouched — NOT the v2 draft).
- A batch of 8–9 scene texts.
- Strict output schema instructions.
- Explicit "do not try to match run-1; this is a self-consistency check" framing on run-2.

The Flash baseline came from the existing book-wide extraction (`mice.20260429T202249.jsonl`, 858 beats), filtered to the 30 sampled scenes.

Analysis script: `/tmp/sonnet-mice-test/analyze.ts`. Output: [`crystal_shard.20260430T002127.cheapest-counterfactual-mice.json`](crystal_shard.20260430T002127.cheapest-counterfactual-mice.json).

### Results

**Sonnet self-consistency (run-1 × run-2, n=30):**

| Field | Agreement | Note |
|---|---|---|
| `primary_thread` (per-field) | **0.800** (24/30) | C vs E confusion concentrated in 4 of the 6 disagreements |
| `secondary_thread` | 0.733 (22/30) | |
| `opens_thread` | 0.900 (27/30) | binary fields more stable than 4-class enum |
| `closes_thread` | 0.933 (28/30) | |
| **`primary_thread` Jaccard (discrete-tuple)** | **0.667** | **BELOW 0.70 floor → "anchor unusable" per v2 gates** |

Confusion matrix on `primary_thread` (rows = run-1, cols = run-2):

```
         M    I    C    E
   M     5    0    0    0      Milieu: 5/5 = 100% (unambiguous)
   I     0    5    0    1      Inquiry: 5/6 = 83%
   C     0    0    6    3      Character: 6/9 = 67% — 3 leak to Event
   E     0    1    1    8      Event: 8/10 = 80% — 1 each to I, C
```

**The C↔E boundary owns the instability.** 4 of the 6 cross-run disagreements are scenes where one Sonnet run says "Character thread dominates" and the other says "Event thread dominates." This is a **rubric-latitude problem at the C/E boundary**, not random model noise.

**Flash × Sonnet (binary "thread fired" = opens_thread || closes_thread):**

| Anchor | tp | fp | fn | tn | P | R | F1 |
|---|---|---|---|---|---|---|---|
| Sonnet run-1 | 18 | 5 | 4 | 3 | 0.783 | 0.818 | **0.800** |
| Sonnet run-2 | 15 | 8 | 4 | 3 | 0.652 | 0.789 | **0.714** |

**Flash F1 range across the two anchors: 0.714–0.800 (Δ=8.6pp; mean=0.757).** The 0.78 PASS gate falls *inside* the range. Whether Flash mice "passes" depends on which Sonnet run you happened to fix as gold. This is the **Sonnet-anchor analog of the C.2 Pro-judge gold-stability ceiling** — same shape, different model family.

For comparison: Phase A Flash × Pro F1 was 0.776, Phase A Flash × Flash (self) was 0.809. Sonnet anchor sits in the same band as Pro and self-judge — the family of the anchor is **not** the dominant variable on the F1 measurement; the rubric latitude is.

### Conclusion

Both gates fail. Rephrasing:

1. **Anchor stability gate**: 0.667 Jaccard, below the 0.70 floor. Per the v2 design doc's own thresholds, the monolithic mice rubric is **unusable as a Sonnet anchor** — re-scoping required before any extractor calibration.
2. **F1 gate**: 0.757 mean (0.714 worst case, 0.800 best case). Below the 0.78 PASS gate on the mean; range straddles the gate. **Decomposition is not refuted by this result; it is corroborated** — the rubric admits two defensible reads of every C↔E scene, and a single 4-way classifier inherits the union of both ambiguities. A binary "is Character present?" sub-call has a tighter cognitive scope and is the right shape to lift each sub-call's stability above 0.85.
3. **Both Codex reviews predicted that monolithic Flash × Sonnet might lift past 0.78 simply because Sonnet is a different family from DeepSeek.** This was disconfirmed. The cross-family anchor does NOT structurally fix the F1 problem; the bound is on the rubric, not the anchor model.

What we learned that neither the v1 conclusions nor the v2 design captured:

- **Sonnet anchor is itself rubric-latitude-vulnerable.** The v2 design implicitly treated Sonnet as a "different family ≈ stable anchor" — this was wrong. Sonnet has the same kind of latitude problem on this rubric that Pro had on promise (R2.2). Cross-family is necessary but not sufficient.
- **The v2 architecture's preflight-gate design IS validated.** The Sonnet self-consistency Jaccard ≥ 0.85 gate is exactly the right shape to catch this — and it caught it before any extractor calibration runs were committed. Without the preflight, we'd have run Phase D extractor calibration against an unstable anchor and reported numbers we couldn't trust.
- **Promise dim has the same shape (preliminary).** The Sonnet promise run-2 (in flight: 66 promises vs run-1's 38; pair-matching pending) suggests Sonnet's anchor is unstable for promise too. The Sonnet 38 ≥ Pro 27–30 ≥ Flash 14 framing in C.1 was a single-run snapshot; anchoring against it would have been premature.

### Action

1. **Decompose mice into 4 binary calls per scene** as the v2 design specified, AND run a fresh Sonnet self-consistency check per sub-call. The hypothesis is each sub-call hits ≥0.85 because the cognitive scope is one thread type, not "pick the dominant of four." If even the binary sub-calls don't clear 0.85, the rubric needs a structural rewrite — not just decomposition.
2. **Treat the v2 design's anchor-stability gate as load-bearing, not procedural.** The mice cheapest-counterfactual is the first concrete validation that the gate catches real problems. Adopt the gate as a hard preflight for every dim under v2.
3. **Defer the "anchor unusable → re-scope" interpretation pending the binary-decomposition test.** The 0.667 Jaccard is on the **monolithic** rubric. The v2 architecture's first move is to test whether the binary sub-calls retire that latitude. If they do, the architecture's promise holds. If they don't, the dim itself may be irreducibly latitude-permissive on this corpus, and we re-scope mice rather than retry it.
4. **Promise pair-matcher result (R1×R2 Sonnet)** in flight via separate subagent. When complete, append to this section as a confirming/disconfirming data point on whether the rubric-latitude problem generalizes across dims.
5. **Sample size note:** n=30 for both gates. The v2 design specifies n=50; the dedup loss from sampler-side duplicates pushed us to n=30. Re-run sampling with `--seed 42 --n 50` against the deduped 858-beat corpus before committing to any v2 extractor verdict. (Sample-size note: 30 unique scenes from a sampler that requested 33 means ~9% of the requested distinct samples collided. Investigate `sample-for-adjudication.ts` for the dup-collision bug.)

### Cost ledger delta (cheapest-counterfactual)

| Step | Calls | Cost |
|---|---|---|
| Sonnet mice run-1 (4 subagents) | 33 scene labels | subagent (separate billing) |
| Sonnet mice run-2 (4 subagents) | 33 scene labels | subagent (separate billing) |
| Flash mice extraction (already on disk) | 858 | already in v1 budget |
| Analysis script (no LLM) | 0 | $0.00 |
| Sonnet promise run-2 (1 subagent, 66 promises) | 1 task | subagent |
| Sonnet promise R1×R2 pair-matcher (subagent, in flight) | 1 task | subagent |
| **Subtotal** | 9 subagents + analysis | **~$0.00 in API; subagent cost separate** |

Cumulative on crystal_shard at promo pricing: ~$4.15 + 0 (this round subagent-only) = **~$4.15**.

---
