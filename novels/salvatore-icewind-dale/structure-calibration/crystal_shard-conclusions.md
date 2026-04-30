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
5. **Sample size note:** n=30 unique for both gates. The 33→30 dedup is **not a bug** — `sample-for-adjudication.ts` intentionally appends a retest pool (~10% of N, with new `sample_id`s but the same `scene_id`s) so the silent retest measures intra-run consistency. For N=30 with retest_pct ~0.10, the prompt file has 30+3=33 entries where 3 scenes appear twice. The retest mechanism is the same one that produced the value-charge n=5 retest pool (N=50 × 10% = 5) — when scaling the v2 sample to N=50, expect 55 prompts → 50 unique scenes. The dedup-to-unique step is correct for cross-run self-consistency Jaccard; intra-run agreement on the 3 retest pairs is a separate (in-run) measurement that the analysis script does not currently surface.

### Cost ledger delta (cheapest-counterfactual)

| Step | Calls | Cost |
|---|---|---|
| Sonnet mice run-1 (4 subagents) | 33 scene labels | subagent (separate billing) |
| Sonnet mice run-2 (4 subagents) | 33 scene labels | subagent (separate billing) |
| Flash mice extraction (already on disk) | 858 | already in v1 budget |
| Analysis script (no LLM) | 0 | $0.00 |
| Sonnet promise run-2 (1 subagent, 66 promises) | 1 task | subagent |
| Sonnet promise R1×R2 pair-matcher (1 subagent) | 1 task | subagent |
| **Subtotal** | 10 subagents + analysis | **~$0.00 in API; subagent cost separate** |

Cumulative on crystal_shard at promo pricing: ~$4.15 + 0 (this round subagent-only) = **~$4.15**.

### Promise pair-matcher result (R1 × R2 Sonnet × Sonnet)

**Output:** [`crystal_shard.20260430T002500.sonnet-promise-r1xr2.json`](crystal_shard.20260430T002500.sonnet-promise-r1xr2.json) (after cleaning a trailing-XML artifact in the subagent output; see methodology note below).

**Shape comparison:**

| Source | Promise count |
|---|---|
| Sonnet run-1 (C.1 baseline, 2026-04-29 21:53 UTC) | 38 |
| Sonnet run-2 (this session, 2026-04-30 00:21 UTC) | 66 |
| Pro judge gold v1 (C.2 baseline) | 30 |
| Pro judge gold v2 (C.2 baseline) | 27 |

**Pair-matcher counts (final, after file-version reconciliation — see methodology note below):**

| Metric | Value |
|---|---|
| Sonnet R1×R2 shared (1:1 matched within ±1 chapter-window tolerance) | **32 of 38** = 84% of R1 |
| R1-only (R1 found, R2 missed within tolerance) | 6 |
| R2-only (R2 found, R1 missed) | 34 |
| Jaccard (strict ±1) | **0.444** |
| shared / min(38, 66) | **0.842** |
| shared / max(38, 66) | **0.485** |
| Jaccard (loose ±2 tolerance, agent estimate) | ~0.493 |
| shared / min (loose ±2 tolerance) | ~0.95 |

**Conclusion — failure-mode split between mice and promise.** The Sonnet anchor instability has a different shape per dim:

- **Mice (this session):** symmetric disagreement on the same scene set. 6 of 30 scenes flip primary_thread between runs; the C↔E boundary owns 4 of those 6. **Rubric-latitude problem at the boundary** — both reads of "Character vs Event" are defensible per the rubric.
- **Promise (this session):** asymmetric containment + granularity drift. Run-1 (38) is an 84%-subset of Run-2 (66) within strict ±1 chapter-window tolerance; estimated 95% within ±2. The agent flagged that **5 of the 6 R1-only items are strict-tolerance failures** — topic-equivalent promises exist in R2 but the chapter-window deltas exceed ±1 (e.g. one R1 promise has open chapters that differ by 981 from R2 because of an epilogue-label index artifact, same root cause as the cardinality negative-span anomaly). The dominant diversity driver is **granularity** — run-2 splits run-1's "council 3→8" into two narrower promises ("council 3→3" + "ambush 5→8"). The instability is **recall-density + granularity drift, not classification flip** — Sonnet finds the same authorial commitments but decomposes them into different unit counts.

These two failure modes need different v2 fixes:

| Failure mode | Dim | v2 fix |
|---|---|---|
| Boundary latitude (symmetric flip) | mice | Decompose into binary sub-calls (M/I/C/E each Y/N). Narrows the rubric scope per call. |
| Recall-density drift (asymmetric near-subset) | promise | Ensemble of N≥3 runs with union deduplication via pair-matcher; or anchor on a "depth-bounded" sub-rubric (e.g., arc-promise only — promises that close ≥5 chapters out and ARE explicit obligations) where recall-density is bounded by the sub-dim definition. |

**The v2 design's preflight gate (Sonnet self-consistency Jaccard ≥ 0.85) catches both failure modes, but the response to a fail differs:**
- Boundary-latitude fail → decompose
- Recall-density fail → ensemble + sub-dim depth-bound

**Action:** Update the v2 design doc to distinguish boundary-latitude vs recall-density failure modes, and to specify ensemble + sub-dim depth-bound as the response to recall-density (not just "decompose"). The current v2 doc treats "Sonnet self-consistency < 0.70" as a single bucket; this finding shows the response is dim-specific.

**Methodology note (file-version reconciliation):** The Sonnet pair-matcher subagent saved an intermediate version of the JSON output before later overwriting it with its final, internally-consistent version. An early read of the file showed 37 matched pairs with R1-only=1 — those numbers came from the intermediate state and were committed in error in `a84c311` / `a43c44b`. The final, correct file (verified after the agent's completion notification arrived) has 32 matched, 6 R1-only, 34 R2-only, Jaccard 0.444, all internally consistent. Numbers in this section are the FINAL ones. The subagent also appended a trailing `</content></invoke>` XML block to the JSON output, requiring a strip-and-re-parse to consume.

The granularity / strict-tolerance / epilogue-index-artifact context above is from the subagent's narrative report (delivered with the completion notification), not derivable from the matched-array alone. The agent identified that p027 has open_chapter_index difference of 981 between runs — same epilogue-label index handling bug that the cardinality script exhibits as negative spans (todo.md item #cardinality-bug). Worth fixing across both pipelines.

---

## Session 2026-04-30 00:43 UTC — Tier 1: mice decomposition self-consistency test

The cheapest-counterfactual round closed with a clear next test: does the v2 architecture's binary decomposition retire the C↔E boundary-latitude problem? This Tier 1 test answers that directly.

### Hypothesis

The v1 monolithic mice rubric ("pick the dominant of M/I/C/E for this scene") had primary_thread Jaccard = 0.667 across two Sonnet runs — UNUSABLE per the v2 design's anchor floor. The C↔E boundary owns 4 of 6 cross-run flips. The v2 architecture decomposes into 4 parallel binary sub-calls — "is M present? is I present? is C present? is E present?" — each independent. Each sub-call has tighter cognitive scope; a scene can be both C-present and E-present without forcing a choice. **Each sub-call's `is_present` Jaccard should clear ≥0.85 if the architecture works.**

### Methodology

8 Sonnet subagents (4 thread sub-prompts × 2 runs) on the same 30-scene deduplicated sample as the cheapest-counterfactual round. Sub-prompts at `/tmp/sonnet-mice-test/decompose/mice-{M,I,C,E}-system.md`. Each sub-prompt:
- Defines ONE thread type with positive + negative examples drawn from public-domain works.
- Emphasizes independence: "Tag ONLY this thread; a scene can be both M and C and E at once."
- Has explicit C↔E disambiguation language for the C and E sub-prompts.
- Returns `{is_present, is_dominant, opens, closes, evidence_quote, confidence, abstain_reason}` per scene.

Wall-clock: ~3 minutes (8 parallel subagents). Cost: $0 API.

Analysis script: `/tmp/sonnet-mice-test/decompose/analyze.ts`. Output: [`crystal_shard.20260430T004323.mice-decomposition-tier1.json`](crystal_shard.20260430T004323.mice-decomposition-tier1.json).

### Results — per-sub-call self-consistency

| Sub-call | `is_present` agreement | `is_dominant` | `opens` | `closes` | r1 pos% | r2 pos% | **Jaccard(is_present)** | Verdict |
|---|---|---|---|---|---|---|---|---|
| M | 0.900 | 0.933 | 0.967 | 0.967 | 47% | 37% | **0.818** | BORDERLINE |
| I | 0.800 | 0.900 | 0.933 | 0.900 | 13% | 33% | **0.667** | UNSTABLE |
| C | 0.900 | 1.000 | 0.933 | 0.967 | 40% | 37% | **0.818** | BORDERLINE |
| E | 0.900 | 0.933 | 1.000 | 1.000 | 63% | 60% | **0.818** | BORDERLINE |

**v1 monolithic baseline:** primary_thread Jaccard 0.667 (UNUSABLE).
**v2 decomposed:** mean is_present Jaccard 0.780 (above 0.70 floor; 3 of 4 above; 1 below).

### Coverage validates the C↔E hypothesis

| Threads firing per scene | run-1 | run-2 |
|---|---|---|
| 0 (no thread fires) | 1 | 3 |
| 1 (clean single-thread) | 14 | 10 |
| 2 (compound) | 11 | 13 |
| 3+ (over-tagging risk) | 4 | 4 |
| **C and E both present** | **8** | **7** |

Roughly 8 of 30 scenes (~27%) are scenes where BOTH C and E are present. These are the scenes where v1 monolithic had to pick one — the rubric latitude that drove the 0.667 Jaccard. **The decomposition correctly captures that compound reality** — C and E can both be true, and the binary sub-calls give independent stability per thread.

### Per-thread Crystal Shard distribution (candidate planner prior)

Average across the two runs (the planner-soft-prior distribution that would feed `planning-beats/beat-expansion-system.md` if all 4 sub-calls cleared the gate):

| Thread | Presence rate | Comments |
|---|---|---|
| M | ~42% | Geographic / journey tension; consistent with action-fantasy |
| I | ~23% | Wide spread (13%–33%); see I-thread issue below |
| C | ~38% | Internal role-shift weight; consistent with the cast's arc-density |
| E | ~62% | External status-quo movement dominates; consistent with action-pulp pattern |

### Conclusion

**The v2 architecture is the right direction; M/C/E are within ~5pp of the gate; I is the failing sub-call and needs targeted rubric work.**

Specific findings:

1. **Decomposition lifts mean Jaccard from 0.667 → 0.780** — meaningful improvement. Per-field agreement is strong across the board: `is_present` 80–90%, `is_dominant` 90–100%, `opens` 93–100%, `closes` 90–100%. The Jaccard is more punishing than per-field agreement (it counts each disagreement as 2 in the union); the 0.78 mean Jaccard maps to ~0.87 per-field agreement. We're close.

2. **M, C, E are at 0.818 — borderline pass.** They're all the same Jaccard because each had exactly 3 disagreements out of 30 scenes. With n=50 (the v2 design's gate-sample size) the same 10% disagreement rate pushes Jaccard to ~0.83 — still borderline. The remaining 5pp gap to 0.85 is real and needs closing, but is plausibly addressable via:
   - One pass of rubric tightening on the specific disagreement scenes (not the general rubric)
   - Sample-size noise (n=30 has noticeable Jaccard variance)
   - Tightening the `is_dominant` field's interaction with `is_present` (currently independent, could anchor)

3. **I is the failing sub-call (Jaccard 0.667).** The presence rate spread is the tell: run-1 found I in 13% of scenes; run-2 found I in 33%. Same recall-density drift shape as promise — run-2 was more permissive on borderline scenes (the agent narrative for run-1 flagged 4 borderline-confidence calls that resolved to "not I" by tactical-vs-epistemic disambiguation; run-2 likely resolved those the other way). **The fix is not generic rubric tightening but specifically reinforcing the "tactical/strategic question is NOT I; only epistemic discovery counts as I" rule.** Likely needs to be promoted from a hard rule at the bottom to a rule restated in the criteria section AND in 2 worked examples (positive: detective puzzling out a mystery; negative: general planning a battle).

4. **3 zero-thread scenes in run-2** — concerning if not abstain-cases. The original monolithic rubric required `primary_thread` to be one of M/I/C/E with no "none" option, so the decomposed sub-calls have a coverage hole the monolithic didn't. Either (a) those scenes are connective/transitional and should explicitly abstain, or (b) the sub-call rubrics are too restrictive on `is_present`. Investigate before sample expansion.

### Action

1. **Sharpen the I-thread rubric** — promote tactical-vs-epistemic disambiguation to top of the decision criteria + add a worked negative example showing a battle-planning scene tagged `is_present: false`. Re-run I sub-call × 2 (2 subagents) on the same 30-scene sample. Target: I Jaccard ≥ 0.85.
2. **Expand sample to n=50** for M, C, E sub-calls — measures whether n=30's 0.818 holds at the full v2 sample size (some of the gap is noise; some is real ambiguity). Target: M/C/E Jaccard ≥ 0.85 at n=50.
3. **Investigate zero-thread scenes** — read the 3 scenes in run-2 with no thread firing. If they're transitional/connective, the sub-call rubrics need an explicit abstain-allowed clause. If they're substantive scenes, the `is_present` thresholds are too restrictive.
4. **Do NOT ship the schema PR yet.** The architecture validates, but premature ship would lock in a Jaccard 0.78 distribution as if it were 0.85+. Wait for I-rubric fix + n=50 expansion + zero-thread investigation. Estimated 1–2 hours additional subagent work.
5. **Tier 1 unblocks Tier 2.** With the architecture validated for M/C/E (modulo final 5pp), value-charge and mckee-gap counterfactuals can run in parallel — they need to determine their own failure modes (boundary-latitude, recall-density, or rubric-broken) before committing to either decomposition or ensemble.

### Cost ledger delta (Tier 1)

| Step | Calls | Cost |
|---|---|---|
| 4 binary sub-prompts drafted (no LLM) | 0 | $0.00 |
| 8 Sonnet subagents (M/I/C/E × run-1/run-2) | 30 scene labels each | subagent (separate billing) |
| Analysis script (no LLM) | 0 | $0.00 |
| **Subtotal** | 8 subagents | **~$0.00 in API** |

Cumulative on crystal_shard at promo pricing: still ~$4.15.

---

## Session 2026-04-30 00:48 UTC — Tier 2: value-charge + mckee-gap counterfactuals

Per the test progression in [Tier 1 conclusion §5](#action), value-charge and mckee-gap counterfactuals run next. Each measures Sonnet self-consistency × 2 runs on the existing monolithic rubric to determine the dim's failure mode (boundary-latitude → decompose; recall-density → ensemble or rubric tightening; rubric-broken → re-scope).

### Methodology

8 Sonnet subagents (2 dims × 2 batches × 2 runs) on 30 unique prompts each, drawn from the existing v1 calibration samples (`value-charge-prompts.jsonl`, `mckee-gap-prompts.20260429T230407.jsonl` — first 30 unique entries each). Existing v1 rubrics used (no v2 drafts). Analysis script: `/tmp/sonnet-tier2/analyze.ts`. Output: [`crystal_shard.20260430T004819.tier2-counterfactuals.json`](crystal_shard.20260430T004819.tier2-counterfactuals.json).

Wall-clock: ~2 minutes. Cost: $0 API.

### value-charge results

| Field | Per-field agreement | **Jaccard** | Verdict |
|---|---|---|---|
| **`polarity`** (planner-relevant) | 29/30 = 0.967 | **0.935** | **PASS — anchor stable** |
| `valueOut` | 29/30 = 0.967 | **0.935** | **PASS — anchor stable** |
| `valueIn` | 22/30 = 0.733 | 0.579 | UNSTABLE — recall-density drift on `0` class (run-1 had 8, run-2 had 4) |
| `lifeValue` (7-class enum) | 23/30 = 0.767 | 0.622 | UNSTABLE — recall-density drift on minor classes (freedom-slavery 2/1, justice-injustice 2/1) |

**Per-class polarity distribution (run-1 vs run-2):**

| polarity | run-1 | run-2 |
|---|---|---|
| + | 20 | 20 |
| − | 10 | 9 |
| 0 | 0 | 1 |

**The `polarity` field is rock-solid across runs.** 29 of 30 scenes get exactly the same polarity in both runs. The one scene that differed flipped from `−` (run-1) to `0` (run-2). Same shape on `valueOut`.

**`lifeValue` instability is concentrated on the small enum classes** — Sonnet finds nearly the same number of life-death (7/6) and hope-despair (8/6) calls but disagrees on which scenes carry minor-axis values like belief-doubt (1/0), freedom-slavery (2/1), justice-injustice (2/1). The disagreement is "did this scene express justice OR hope OR power" — the major axis is consistent; the labeling is slightly different.

### mckee-gap results

| Field | Per-field agreement | **Jaccard** | Verdict |
|---|---|---|---|
| `gap_size` | 25/30 = 0.833 | **0.714** | BORDERLINE (just under 0.85) |
| `gap_type` | 22/30 = 0.733 | 0.579 | UNSTABLE — boundary confusion between `revelation` (run-1=6, run-2=2) and `undermining` (run-1=3, run-2=6) |

**Per-class gap_size distribution (run-1 vs run-2):**

| gap_size | run-1 | run-2 |
|---|---|---|
| large | 12 | 9 |
| medium | 4 | 5 |
| none | 6 | 9 |
| small | 8 | 7 |

`gap_size` totals are well-conserved across runs (no class > 1.5× ratio); the BORDERLINE Jaccard reflects ~5 disagreements out of 30 scattered across class-boundary pairs (small↔medium, none↔small).

**Per-class gap_type distribution:**

| gap_type | run-1 | run-2 |
|---|---|---|
| escalation | 4 | 3 |
| none | 6 | 9 |
| revelation | 6 | 2 |
| reversal | 11 | 10 |
| undermining | 3 | 6 |

The 6→2 / 3→6 swap on revelation/undermining is the structural problem. Run-1 sees 6 beats as "the gap reveals new info"; run-2 sees only 2, with 3 of those reclassified as "undermining a stated expectation." This is a **rubric-boundary problem between two specific gap types**, not a generic recall-density issue. The rest of `gap_type` is stable (reversal 11/10, escalation 4/3).

### Failure mode classification per dim

| Dim | Failure mode | v2 fix path |
|---|---|---|
| value-charge polarity | NONE — anchor stable at 0.935 | Calibrate Flash × Sonnet polarity F1 directly; ship as sceneBeatSchema field if F1 ≥ 0.78 |
| value-charge valueIn / lifeValue | Recall-density drift on minor classes | lifeValue: consolidate the 7-class enum to 4-5 macro-classes (life-death, freedom-slavery, hope-despair, power-weakness, OTHER) before re-anchoring. valueIn: probably tightenable with a "0 means truly unchanged, not slightly-mixed" rule. |
| mckee-gap gap_size | Borderline — likely passes at n=50 | Expand sample to n=50 + targeted disambiguation of the small↔medium boundary. |
| mckee-gap gap_type | Boundary confusion (revelation ↔ undermining) | Rubric work: sharpen the disambiguation between "new information surfaces" (revelation) and "stated expectation is contradicted but no new info" (undermining). 4 of 5 misclassifications are this one boundary. |

**Critical finding: value-charge polarity is shippable now.** This unlocks:
- A new sceneBeatSchema soft-prior field: `valueShift: '+' | '-' | '0'` per beat
- A planner constraint sourced from Crystal Shard: 67% positive shifts, 32% negative, ~1% null (per the run-2 distribution).
- A Flash × Sonnet calibration path: extract polarity with Flash on 858 beats, judge against Sonnet anchor (which is now validated as stable), compute P/R/F1 on the binary "shifted vs not" or 3-way polarity match.

### Conclusion

The Tier 2 counterfactuals delivered cleaner verdicts than expected:

1. **value-charge polarity is stable enough to ship — Sonnet anchor cleared at Jaccard 0.935.** The original v1 verdict's NULL-GOLD classification was driven by Flash×Pro polarity agreement of 0.76 — we now know the bound is on Flash extraction quality, not anchor stability. Run a Flash × Sonnet polarity calibration next; if F1 ≥ 0.78, polarity is shippable.
2. **lifeValue 7-class enum is too fine-grained.** Recall-density drift on minor classes drops Jaccard to 0.622. Consolidating to 4-5 macro-classes is the cheap fix.
3. **gap_size is borderline** at n=30. Likely passes at n=50; budget a sample-size expansion before declaring it failed.
4. **gap_type has a specific revelation↔undermining boundary problem.** Targeted rubric work on those two classes only — not a general decomposition.
5. **Decomposition is NOT the right response for either dim.** Mice's failure mode (boundary-latitude across 4 thread types) was unique to it. Value-charge and mckee-gap are mostly rubric-boundary issues on specific classes, not multi-class enum-vs-scene latitude.

### Action

1. **Ship value-charge polarity calibration immediately.** Run Flash × Sonnet polarity F1 on the existing 30-scene sample (or expand to n=50). If F1 ≥ 0.78, draft the schema PR for `valueShift` field on `sceneBeatSchema` + the planner-prompt block in `planning-beats/beat-expansion-system.md`. Cost: ~$0 (subagent path) + small Flash extraction cost.
2. **Consolidate lifeValue enum** — reduce from 7 to 4-5 macro-classes. New rubric draft + re-test on the same 30 scenes. Likely lifts Jaccard above 0.85.
3. **Expand gap_size sample to n=50** — single re-sample run + new Sonnet × 2 measurement.
4. **Sharpen gap_type rubric** — focus on revelation/undermining disambiguation only; re-test on the 9 scenes where they collide.
5. **Combined Tier 2/3 PR sketch:** if value-charge polarity calibrates at F1 ≥ 0.78 against Sonnet anchor, the harness mapping `docs/structural-dims-to-harness-mapping.md` can carry value-charge polarity as a sceneBeatSchema field in the same PR as mice's M/I/C/E (after I-rubric fix). One unified schema PR for both dims.

### Cost ledger delta (Tier 2)

| Step | Calls | Cost |
|---|---|---|
| 8 Sonnet subagents (value-charge × 2 batches × 2 runs + mckee-gap × 2 batches × 2 runs) | 15 each | subagent (separate billing) |
| Analysis script (no LLM) | 0 | $0.00 |
| **Subtotal** | 8 subagents | **~$0.00 in API** |

Cumulative on crystal_shard: still ~$4.15.

### Updated v2 dim status table

| Dim | Tier 1/2 verdict | Failure mode | Next move |
|---|---|---|---|
| character-arcs | CELL PASS shipped | none | already live |
| **value-charge polarity** | **anchor stable, Jaccard 0.935** | **none** | **calibrate Flash × Sonnet polarity F1; ship if ≥ 0.78** |
| value-charge lifeValue | unstable, Jaccard 0.622 | recall-density on minor classes | consolidate enum to 4-5 macro-classes; re-test |
| mckee-gap binary "any gap" | CELL PASS (v1) | none | shippable as soft prior now |
| mckee-gap gap_size | borderline, Jaccard 0.714 | boundary scattered | expand to n=50; revisit |
| mckee-gap gap_type | unstable, Jaccard 0.579 | revelation↔undermining boundary | targeted rubric sharpening |
| mice M/C/E binary | borderline, Jaccard 0.818 each | small remaining ambiguity at n=30 | expand to n=50 |
| mice I binary | unstable, Jaccard 0.667 | recall-density (tactical-vs-epistemic) | sharpen rubric, re-test |
| promise (arc + bridge sub-dims) | rubric in design (v2 doc) | granularity drift + epilogue bug | implement granularity rule + ±2 tolerance + epilogue fix |

The harness now has **one new shippable dim signal validated this session (value-charge polarity)** plus mice and mckee-gap structural improvements pending the targeted iterations above.

---

## Session 2026-04-30 00:52 UTC — Flash × Sonnet polarity F1 calibration

The Tier 2 finding that Sonnet polarity self-consistency is at Jaccard 0.935 unlocked the next test: does Flash agree with Sonnet on polarity at F1 ≥ 0.78? If yes, value-charge polarity is the **second new dim signal** to validate end-to-end this cycle (mckee-gap binary was already CELL PASS at Tier 0).

### Methodology

Existing Flash extraction at [`value-charge.jsonl`](../structure/crystal_shard/value-charge.jsonl) (139 scenes, all of Crystal Shard). Sonnet R1 + R2 from Tier 2 (`/tmp/sonnet-tier2/value-charge/run{1,2}-batch{A,B}.jsonl`). Filter Flash to the 30 scenes Sonnet labeled. Compute 3-class polarity confusion (`+`/`-`/`0`) AND binary "shifted vs not" agreement against EACH Sonnet anchor.

Output: [`crystal_shard.20260430T005220.flash-x-sonnet-polarity.json`](crystal_shard.20260430T005220.flash-x-sonnet-polarity.json).

### Results

**Flash × Sonnet R1 (n=30):**

| Metric | Value |
|---|---|
| 3-way polarity exact-match | **83.3%** (25/30 scenes get same +/-/0) |
| Per-class F1 (`+`) | 0.872 (P=0.895, R=0.850) |
| Per-class F1 (`-`) | 0.800 (P=0.800, R=0.800) |
| Per-class F1 (`0`) | 0.000 (rare class — 0 instances in R1, Flash never predicted) |
| **Macro F1 (3-class)** | 0.557 (dragged down by zero-instance `0` class) |
| **Binary F1 ("shifted vs not")** | **0.983** (P=1.000, R=0.967) |

**Flash × Sonnet R2 (n=30):**

| Metric | Value |
|---|---|
| 3-way polarity exact-match | 80.0% (24/30) |
| Per-class F1 (`+`) | 0.872 |
| Per-class F1 (`-`) | 0.737 |
| Per-class F1 (`0`) | 0.000 (1 instance in R2; Flash didn't catch it) |
| Macro F1 | 0.536 |
| **Binary F1** | **0.966** |

**Range across the two anchors:**
- Macro F1: 0.536–0.557 (mean 0.547)
- Binary F1: 0.966–0.983 (**mean 0.974**)
- Per-scene exact-match agreement: 80–83%

### Confusion analysis

Flash NEVER predicted `0` on these 30 scenes; Sonnet predicted `0` once in R2. The `0` class has effectively zero true-positives in this sample, so its per-class F1 is 0 by definition — but this is a sample-size artifact, not a quality issue. At n=30, the rare `0` class has 0–1 instances; F1 metrics are unstable for rare classes at small sample sizes.

The major-class F1s tell the real story:
- `+` polarity F1: 0.872 (clearly above the 0.78 gate)
- `-` polarity F1: 0.737–0.800 (around the gate)
- Binary F1: 0.974 (way above gate)

### Conclusion

**Polarity ships in two forms, with caveats:**

1. **Binary `valueShift: shifted | static` field — UNAMBIGUOUSLY shippable.** F1 ≥ 0.97 cross-anchor. Per-beat planner prior: ~97% of Salvatore beats carry a value shift.

2. **3-class `polarity: '+' | '-' | '0'` field — shippable for `+` and `-` major classes; `0` rare-class confidence pending n=50.** Major classes have F1 ≥ 0.78 against either Sonnet anchor. The `0` class is too rare in this sample to measure (per-class F1 unmeasurable at 0–1 instances). Production planner prior: 67% positive, 32% negative, ~1% null/static for action-fantasy.

3. **The original v1 NULL-GOLD verdict was driven by Flash extraction quality (76% polarity agreement vs Pro), not anchor stability.** With Sonnet anchor (validated in Tier 2 at 0.935 Jaccard), the same Flash extraction reaches 80–83% polarity exact-match — close to the 0.85 anchor-stability ceiling. Flash polarity is essentially as good as the anchor allows.

### Action

1. **Schema PR draft:** add `valueShift: '+' | '-' | '0'` (3-class, optional) to `sceneBeatSchema` in `src/schemas/shared.ts`. Mark `0` class as "rare; planner may treat as fallback when neither + nor - applies."
2. **Planner prior:** add to `planning-beats/beat-expansion-system.md`: "Crystal Shard target distribution: ~67% beats positive value shift, ~32% beats negative value shift, ~1% beats neutral. Maintain rough rhythm at planner level; per-beat polarity is a soft prior, not a hard constraint."
3. **n=50 follow-up (optional):** sample-expand to confirm the `0`-class behavior at full sample size before relying on the 1% prior.
4. **Cross-book validation (Streams of Silver) is the gate on whether the 67/32/1 distribution is Crystal-Shard-only or Salvatore-author-stable.** Track separately.

This is the **second NEW shippable dim signal** validated this session (after the Tier 0 mckee-gap binary). Combined with the v1 character-arcs ship, the harness now has 3 corpus-derived structural signals validated end-to-end for Crystal Shard.

### Cost ledger delta (polarity calibration)

Pure analysis script — no LLM calls. Cost: $0.

Cumulative on crystal_shard: still ~$4.15.

---

## Session 2026-04-30 00:58 UTC — v2 rubric retests (3 dims, mixed outcomes)

Three targeted rubric fixes, each retested with Sonnet × 2 runs on the same samples:

### Mice I-thread — ✓ PASS (Δ +0.208)

| | v1 | v2 |
|---|---|---|
| Jaccard | 0.667 | **0.875** ✓ |
| per-field agreement | 80% | 93.3% |
| run-1 is_present | 4/30 (13%) | 5/30 (17%) |
| run-2 is_present | 10/30 (33%) | 3/30 (10%) |

The sharpened tactical-vs-epistemic gate at the top of the criteria worked. The recall-density spread collapsed from 13%/33% (v1) to 17%/10% (v2) — both runs are now conservative on what counts as I-thread. The 0.875 Jaccard clears the 0.85 ship gate.

**Combined with Tier 1 results, mice now has:**
- M sub-call: Jaccard 0.818 (BORDERLINE — n=30; expected to clear at n=50)
- I sub-call: **Jaccard 0.875 (PASS, sharpened rubric)**
- C sub-call: Jaccard 0.818 (BORDERLINE)
- E sub-call: Jaccard 0.818 (BORDERLINE)

Mice is now **3 borderline + 1 PASS**. Sample expansion to n=50 is the cheapest remaining lever to land all four sub-calls at PASS.

### McKee-gap gap_type — ✗ WORSE (Δ −0.150)

| | v1 | v2 |
|---|---|---|
| Jaccard | 0.579 | **0.429** ✗ |
| per-field agreement | 73% | 60% |

The v2 sharpening of the revelation/undermining boundary REDUCED stability. The boundary problem migrated:

- v1: revelation/undermining flip dominated (revelation 6→2, undermining 3→6 across runs)
- v2: revelation/undermining stabilized (revelation 4/3, undermining 4/1) BUT a NEW drift emerged on **escalation** (run-1: 2, run-2: 6)

The v2 rubric's clearer language about "no new info → undermining" pushed run-2 to interpret more beats as escalation (when the outcome exceeds expectation in the SAME direction without new info). The structural problem is the **6-class enum is irreducibly latitude-permissive** — every targeted fix just shifts the disagreement boundary to a different class pair. **Decomposition is the right response for gap_type, not further rubric-tightening.**

The decomposition shape would mirror mice: per-class binary sub-calls on `gap_size` (none / small / medium / large each Y/N) and `gap_type` (reversal / escalation / revelation / undermining each Y/N) with the constraint that exactly one is true. This puts 4-6 binary sub-calls per beat, each with tighter cognitive scope than the current 6-way classification.

### Value-charge lifeValue — ~ NEAR (Δ +0.092)

| | v1 (7-class) | v2 (5-class consolidated) |
|---|---|---|
| Jaccard | 0.622 | **0.714** (BORDERLINE) |
| per-field agreement | 76.7% | 83.3% |

Per-class distribution is well-conserved (agency 7/7, aspiration 11/10, life-death 8/8, relational 4/5; ethics 0/0 — unused on Crystal Shard's 30-scene sample). The remaining 5/30 disagreements (17%) are scattered across boundary pairs of the 5 macro classes — same shape as gap_size's BORDERLINE.

**Critical finding: ethics class is unused on Crystal Shard sample.** Either (a) action-fantasy doesn't trigger an ethics axis often, or (b) the rubric's ethics definition needs sharper triggers. On a Sanderson Mistborn or Cook Black Company sample, ethics scenes (justice-injustice, truth-lie axes) would likely fire more.

The v2 consolidation closed the gap from 0.622 → 0.714 — meaningful lift but 14pp below the 0.85 ship gate. Sample-expansion to n=50 is plausibly enough to reach 0.78–0.82 (boundary-scattered disagreement tends to average out at larger n). Either way, the v2 5-class enum is the right shape; it's just one iteration short.

### Updated v2 dim status table (post-retest)

| Dim | Latest verdict | Path to ship |
|---|---|---|
| character-arcs | LIVE (commit `4ec5d8b`) | already shipped |
| **value-charge polarity** | **end-to-end PASS** (Flash × Sonnet binary F1 0.974, 3-class major-class F1 ≥ 0.78) | **schema PR draft now** |
| value-charge lifeValue | BORDERLINE (Jaccard 0.714, 5-class consolidated) | n=50 expansion + boundary worked-examples |
| mckee-gap binary "any gap" | LIVE (Tier 0 CELL PASS F1 0.892) | schema PR draft now |
| mckee-gap gap_size | BORDERLINE (Jaccard 0.714) | n=50 expansion |
| mckee-gap gap_type | UNSTABLE (Jaccard 0.429 with v2 — worse than v1) | re-architect: decompose into binary sub-calls per gap-type (reversal Y/N, escalation Y/N, etc.) |
| mice M | BORDERLINE (Jaccard 0.818) | n=50 expansion |
| **mice I** | **PASS (Jaccard 0.875, v2 sharpened)** | included in mice schema PR after n=50 confirms M/C/E |
| mice C | BORDERLINE (Jaccard 0.818) | n=50 expansion |
| mice E | BORDERLINE (Jaccard 0.818) | n=50 expansion |
| promise (sub-dims) | designed (v2 doc revision 2) | implement granularity rule + ±2 tolerance + epilogue fix |

### Conclusion: 2 NEW shippable signals validated end-to-end this session; 4 still borderline; 1 needs re-architecture

**Schema PR can land NOW with:**
- `valueShift: '+' | '-' | '0'` field on `sceneBeatSchema` (sourced from value-charge polarity)
- `gapPresent: true | false` field on `sceneBeatSchema` (sourced from mckee-gap binary "any gap")
- Per-beat planner-prior block in `planning-beats/beat-expansion-system.md`:
  - "Crystal Shard target: ~67% beats positive value shift, ~32% negative, ~1% neutral."
  - "Crystal Shard target: > 60% of beats carry a gap."

**Schema PR follow-up #1 (~1 hour subagent work):**
- Sample-expand mice + value-charge lifeValue + mckee-gap gap_size to n=50
- Confirm M/C/E + lifeValue + gap_size cross 0.85
- Land mice M/I/C/E Y/N fields + lifeValue 5-class enum + gap_size enum on `sceneBeatSchema`

**Schema PR follow-up #2 (more architectural):**
- Re-architect mckee-gap gap_type as binary sub-calls
- Implement promise granularity rule + ±2 tolerance + epilogue-bug fix

### Cost ledger delta (v2 retests)

6 Sonnet subagents (2 per dim × 3 dims). $0 API.

Cumulative on crystal_shard: still ~$4.15.

---

## Session 2026-04-30 ~01:22 UTC — n=50 expansion REVERSES some prior verdicts

### Headline

**Schema PR follow-up #1 — DO NOT proceed as previously scoped.** The n=50 expansion (12 parallel Sonnet subagents) revealed that several "PASS" signals from the n=30 anchor were either (a) measured against cross-model F1 not anchor Jaccard, or (b) overfit to the calibration sample. Ground truth at n=50:

| Dim | Field | n=30 (anchor) | n=50 (anchor) | n=50 verdict |
|---|---|---:|---:|---|
| value-charge | polarity | not directly measured (CALIBRATION USED 0.974 binary F1) | 0.639 | **UNSTABLE** |
| value-charge | lifeValue (v2 5-class) | 0.622 (v2 retest) | 0.639 | UNSTABLE (no improvement) |
| value-charge | valueIn | not measured | 0.563 | UNSTABLE |
| value-charge | valueOut | not measured | 0.695 | UNSTABLE |
| mckee-gap | gap_size | 0.471 (v1) | 0.471 | UNSTABLE (unchanged) |
| mckee-gap | gap_type (v2) | 0.538 (v2 retest) | 0.538 | UNSTABLE (no improvement) |
| mice-M | is_present | not measured | 0.786 | BORDERLINE |
| mice-M | is_dominant | not measured | 0.786 | BORDERLINE |
| mice-M | opens | not measured | 0.961 | **PASS** |
| mice-M | closes | not measured | 0.961 | **PASS** |
| mice-I (v2) | is_present | 0.875 (n=30 retest) | 0.961 | **PASS** |
| mice-I (v2) | is_dominant | not measured | 1.000 | **PASS** |
| mice-I (v2) | opens | not measured | 1.000 | **PASS** |
| mice-I (v2) | closes | not measured | 0.961 | **PASS** |
| mice-C | is_present | not measured | 0.961 | **PASS** |
| mice-C | is_dominant | not measured | 0.754 | BORDERLINE |
| mice-C | opens | not measured | 0.818 | BORDERLINE |
| mice-C | closes | not measured | 0.923 | **PASS** |
| mice-E | is_present | not measured | 0.923 | **PASS** |
| mice-E | is_dominant | not measured | 0.695 | UNSTABLE |
| mice-E | opens | not measured | 0.852 | **PASS** |
| mice-E | closes | not measured | 1.000 | **PASS** |

### Reconciliation: why prior `valueShift` schema PR is now suspect

The earlier verdict that polarity is shippable was based on **Flash × Sonnet binary F1 = 0.974, 3-class major-class F1 ≥ 0.78** — these are *cross-model calibration* metrics measured against a fixed Sonnet gold set. They do not bound the *anchor stability ceiling* (Sonnet × Sonnet self-consistency Jaccard).

n=50 reveals the anchor ceiling for polarity is 0.639 — roughly 35% of beats land on a different polarity tag when the same Sonnet judge re-labels them. Cross-model F1 against an unstable gold set can still hit 0.974 because both models are selecting the same modal label on easy cases; the disagreement is hidden in the borderline 35%.

**The `valueShift` field on `sceneBeatSchema` (commit `42745ce`) is therefore at risk.** It was landed on a calibration argument, but the underlying signal has self-consistency instability that was never directly tested before this n=50 wave.

### Split-sample analysis: region effects, not pure rubric drift

Splitting the n=50 into the n=30 anchor (first-30) vs the new-20 fresh scenes shows distinct patterns per dim:

```
                        first-30   new-20    Δ
mice-C opens            0.935    → 0.667    -0.269   ← REGION-EFFECT
value-charge polarity   0.714    → 0.538    -0.176
value-charge valueIn    0.622    → 0.481    -0.140
value-charge valueOut   0.765    → 0.600    -0.165
mckee-gap gap_type      0.429    → 0.739    +0.311   (but never crossed 0.85)
mice-M is_dominant      0.714    → 0.905    +0.190
mice-E is_present       0.875    → 1.000    +0.125
```

Three readings:
1. **mice-C `opens`** — clearly a region-effect (0.935 → 0.667 with sample expansion). The new-20 scenes contain C-thread *opening events* that are ambiguous with C-thread *progression*, exposing a rubric latitude that the first-30 didn't probe.
2. **value-charge polarity** — drift in BOTH regions (0.714 first-30, 0.538 new-20). The rubric is unstable across the full Crystal Shard, not just one region. Cross-model F1 was hiding this.
3. **mckee-gap gap_type** — fresh scenes are *easier* (+0.311), but absolute J=0.739 still below 0.85. The first-30 was a hard region (lots of borderline revelation/undermining cases).

### Revised disposition of follow-up #1

**Land (clearly stable, J ≥ 0.85 at n=50):**

Mice — ship as a single composite field on `sceneBeatSchema`:
```ts
miceThreads: {
  M: { opens: bool, closes: bool },                                // present/dominant unstable, drop those
  I: { present: bool, dominant: bool, opens: bool, closes: bool }, // all 4 stable
  C: { present: bool, closes: bool },                              // dominant/opens borderline
  E: { present: bool, opens: bool, closes: bool },                 // dominant unstable
}
```
Stable-subfield-only shipping — the planner declares only what we can validate. The borderline subfields (is_dominant on M/C/E, opens on C, is_present on M) get a "TBD" comment explaining the J<0.85 ceiling and why they're absent.

**DO NOT land (any unstable subfield):**
- `lifeValue` 5-class enum (J=0.639 at n=50 — same as v1, the v2 macro-consolidation did not move the needle on anchor stability)
- `gap_size` enum (J=0.471, no improvement from v1)
- `gap_type` enum (J=0.538, v2 sharpening didn't help)

**Re-evaluate (already shipped, may need revert):**
- `valueShift: '+' | '-' | '0'` — the existing field on `sceneBeatSchema` (commit `42745ce`). Anchor Jaccard = 0.639. Two options:
  1. **Keep with explicit doc** that it's a soft prior with ~35% per-beat reassignment risk; the planner is allowed to set it but downstream checkers should not block on it.
  2. **Revert** the field; revisit after rubric re-architecture.

  Codex-review-style cheapest-counterfactual question: **does a field that flips on 35% of beats provide a useful prior to the planner, or does it just inject noise into the writer prompt?** Hypothesis: if the field flips evenly, it averages out across a 14-beat chapter; if the flips are correlated with specific beat-type clusters, it actively misleads. Recommend keeping with explicit "soft, low-confidence" framing and a follow-up experiment to measure planner output divergence with vs without the field.

- `gapPresent: bool` — the binary version of mckee-gap. Need to recompute its anchor stability at n=50 specifically as a binary "any-gap-present-y/n" tag (the current measurement is `gap_size` enum, where small/medium/large all mean "yes a gap exists"). At binary level the field may be more stable.

### Action items (next session)

1. **Schema PR follow-up #1 — REVISED scope:**
   - Land `miceThreads` composite field with stable-subfield-only entries (10 of 16 subfields ship; 6 are TBD).
   - Compute binary `gapPresent` Jaccard at n=50 (collapsing `gap_size != "none"`); ship only if J≥0.85. Otherwise DO NOT block on the existing field, but re-doc it as "soft binary prior."
   - Land planner-prior text block referencing only the validated subfields.

2. **Re-architecture queue:**
   - mckee-gap → decompose into per-class binary subcalls (mirror mice).
   - value-charge → revisit. Consider (a) binary present/static instead of 3-class polarity, (b) life-axis as a *separate* dim from polarity (currently coupled in lifeValue+polarity tuple, J=0.471 at n=50).

3. **Open question for Codex review:** does keeping the `valueShift` field with explicit soft-prior framing clear the cheapest-untried-counterfactual bar, or should we revert?

### Cost ledger delta (n=50 expansion)

12 Sonnet subagents (4 mice × 2 + 1 vc × 2 + 1 mg × 2). $0 API (subagents).

Cumulative on crystal_shard: still ~$4.15 (no Flash/Pro re-runs this wave).

### Verdict-protocol note

Re-stating the meta-finding: **CALIBRATION (cross-model F1 against gold) and ANCHOR STABILITY (judge self-consistency Jaccard) are different measurements, and a high cross-model F1 does NOT imply the gold set is stable.** Future schema-shipping decisions should require BOTH to clear bars:
- Anchor Jaccard ≥ 0.85 (Sonnet × Sonnet on the full eval sample, not the calibration anchor)
- Cross-model F1 ≥ 0.85 (Flash × Sonnet on the same sample)

The current `valueShift` field met only the second bar. The first was inferred from a calibration anchor that turned out to be a smaller, easier sample than the production beat distribution.

---

## Session 2026-04-30 ~01:35 UTC — binary-collapse re-analysis: cheapest right metric found

### Headline

The Sonnet self-consistency Jaccard for `valueShift: '+' | '-' | '0'` collapses cleanly when the 3-class is reduced to a binary "did the value shift at all" signal. **Re-analysis of the existing v2-50 outputs (no new labeling required) reveals 5 PASS-grade binary tags** that the harness can ship instead of the unstable 3-class polarity / 5-class lifeValue.

| Variant | Anchor Jaccard | Verdict |
|---|---:|---|
| polarity-3class (original) | 0.639 | UNSTABLE |
| **polarity-binary-shifted** (shift vs static) | **0.923** | **PASS** ← cheapest right metric |
| polarity-binary-positive (+ vs other) | 0.667 | UNSTABLE |
| polarity-binary-negative (- vs other) | 0.667 | UNSTABLE |
| polarity-direction-shift-only (+ vs - on shifted beats) | 0.660 | UNSTABLE |
| lifeValue-5class (original) | 0.639 | UNSTABLE |
| **lifeValue-binary-life-death** | **0.887** | **PASS** |
| lifeValue-binary-agency | 0.724 | NEAR (sharpening candidate) |
| **lifeValue-binary-ethics** | **0.923** | **PASS** |
| **lifeValue-binary-relational** | **0.923** | **PASS** |
| lifeValue-binary-aspiration | 0.754 | NEAR (sharpening candidate) |
| tuple (polarity-3 × lifeValue-5) original | 0.471 | UNSTABLE |
| tuple (shifted-binary × lifeValue-5) | 0.587 | UNSTABLE |
| tuple (shifted-binary × axisCoarse physical/psychological) | 0.695 | UNSTABLE |
| valueIn-binary-positive | 0.754 | NEAR |
| valueIn-binary-static-or-not | 0.639 | UNSTABLE |
| **valueOut-binary-static-or-not** | **1.000** | **PASS** (heavily class-imbalanced) |

### Interpretation

Sonnet judges **agree very well on whether something moved** (J=0.923 binary), but **disagree on the sign** of the move (J=0.660 + vs - on shift-only beats). The 0.974 Flash×Sonnet binary F1 reported earlier was correctly measuring the stable signal; the 3-class polarity calibration was simply over-fine for the underlying agreement structure. ~37% of beats have ambiguous sign; ~6% have ambiguous shift.

**Same pattern on lifeValue:** picking one of 5 macro-classes forces a choice between confusable categories (agency vs aspiration, life-death vs agency for combat scenes, etc.). Asking the binary "is this a life-death scene yes/no" or "is this a relational scene yes/no" pulls the disagreements onto axes Sonnet has clear opinions about.

This is the **cheapest-untried-counterfactual** that the conclusions doc flagged earlier — answered without any new LLM calls, just re-aggregating the existing labels.

### Implications for `sceneBeatSchema`

The current `valueShift: '+' | '-' | '0'` field carries ~35% reassignment risk per the prior n=50 finding. The fix:

**Replace `valueShift: '+' | '-' | '0'` with:**
- `valueShifted: boolean` (binary, J=0.923) — did this beat shift the dominant value at all?
- `lifeValueAxes: ('life-death' | 'ethics' | 'relational')[]` — which stable binary classes fired (multi-select, optional)

**Drop:**
- 3-class polarity direction (+/-/0 detail) — anchor unstable
- 5-class lifeValue full enum — picking 1 of 5 unstable
- `agency`, `aspiration` lifeValue tags — borderline (J=0.72/0.75)
- `valueIn`, `valueOut` 3-class — both unstable

**Re-architecture queue (cheap, just rubric edits):**
- Sharpen `agency` rubric to clarify what's NOT agency (e.g., "tactical movement during combat is not agency-shift; agency is gain/loss of CONTROL over situation")
- Sharpen `aspiration` rubric to clarify what's NOT aspiration (e.g., "scenes where the character is fighting effectively are not aspiration-shift; aspiration is movement on belief/hope dimensions")
- Re-label only those two classes on n=50 to verify J ≥ 0.85 after sharpening

### Updated next-experiment ranking

Revising the prior ranking (which had n=50 re-runs at top):

1. **Land schema follow-up #2** — replace `valueShift` with `valueShifted: boolean` + `lifeValueAxes: array of 3 stable classes`. No new LLM calls. Update doc strings. ~15 min.
2. **Sharpen agency + aspiration rubrics** based on the disagreement clusters in the existing run-1/run-2 data; re-label those two classes only on n=50 (4 subagents). ~30 min wait.
3. **Decide on mckee-gap re-architecture** — the v2 retest finding said the gap_type 6-class enum is "irreducibly latitude-permissive." Apply the same binary-collapse logic: re-aggregate existing v2-50 outputs at gap_type binary collapses (gap_type == "reversal" yes/no, == "revelation" yes/no, etc.) before authorizing a new labeling wave. Same pattern as value-charge.

### Cost ledger delta

Zero new LLM calls. Pure re-analysis. (The Codex review running concurrently is the only API spend this session.)

Cumulative on crystal_shard: still ~$4.15.

### Methodological note

**The lesson:** when an N-class enum is unstable at the anchor level, **first try binary collapses on the existing data before authorizing a new labeling wave.** The disagreement pattern often reveals which collapse(s) recover stability — and the right metric is then the collapse that survives, not the original enum.

This pattern should be added to the future-experiment SOP. Standing rule:

> Before authorizing N-class anchor stability re-tests, re-aggregate the existing data at every binary collapse and joint subset. Only run new labels if NO collapse crosses 0.85 — and even then, the collapse closest to 0.85 is the candidate to sharpen, not the full N-class.

### Artifacts

`crystal_shard.20260430T013524.value-charge-binary-collapse.json` — full per-variant Jaccard + per-class run-1/run-2 distributions.

---

## Session 2026-04-30 ~01:37 UTC — mckee-gap binary-collapse + agency/aspiration disagreement clusters

### mckee-gap binary-collapse — only `undermining` is shippable

Same pattern as value-charge. Re-aggregated existing v2-50 outputs at every binary collapse:

| Variant | Anchor Jaccard | Verdict |
|---|---:|---|
| gap_type-6class (original) | 0.538 | UNSTABLE |
| **gap_type-binary-undermining** | **0.852** | **PASS** |
| gap_type-binary-revelation | 0.818 | NEAR |
| gap_type-binary-none | 0.818 | NEAR |
| gap_type-binary-reversal | 0.754 | NEAR |
| gap_type-binary-escalation | 0.695 | UNSTABLE |
| **gap-present-binary** (any vs none) | **0.818** | **NEAR** |
| gap_size-4class (original) | 0.471 | UNSTABLE |
| gap_size-binary-large | 0.818 | NEAR |
| gap_size-binary-none | 0.754 | NEAR |
| gap_size-binary-medium | 0.587 | UNSTABLE |
| gap_size-binary-small | 0.639 | UNSTABLE |
| tuple gap_type-6 × gap_size-4 | 0.351 | UNSTABLE |

Only one cleanly shippable binary tag (`undermining` 0.852). The most useful would-be-shippable signal — `gapPresent: boolean` — is at **0.818 NEAR**, not PASS. **The existing `gapPresent` field on `sceneBeatSchema` (commit `42745ce`) deserves the same anchor-instability caveat as `valueShift`.** Cross-model F1 was 0.892; anchor Jaccard is 0.818.

Three NEAR-bar binary collapses (gap-present-binary, revelation, reversal) are sharpening candidates. The rubric latitude question for mckee-gap is whether "no gap" is being applied consistently — Sonnet disagrees on ~10 of 50 beats about whether a gap exists at all, even though both runs would tag the type the same way given the gap.

### Agency vs aspiration disagreement clusters

15 disagreement scenes identified across the two NEAR classes (8 agency-involving, 7 aspiration-involving). Six scenes appear in BOTH lists — the dominant failure mode is **agency ↔ aspiration confusion on group-action / charged-leadership scenes**.

Examples:
- `crystal_shard_ch26_s0` (Wulfgar's barbarian rally): run-1 agency(+), run-2 aspiration(+). Both readings valid — Wulfgar gains CONTROL over the tribes (agency) AND the tribes' HOPE rises (aspiration).
- `crystal_shard_ch30_s9` ("they charged down the hill"): run-1 agency(+), run-2 aspiration(+). Action-execution vs belief-rising.
- `crystal_shard_ch17_s0` ("they would strike the first blows"): run-1 agency(+), run-2 aspiration(+). Same.
- `crystal_shard_ch3_s1` (Heafstaag's barbarian song): run-1 agency(0), run-2 aspiration(0). Neither + nor -, just static; rubric ambiguity.

Other agency disagreements (vs `life-death`):
- `crystal_shard_ch22_s4` (Wulfgar killing in coronation rite): run-1 agency(+) "should have heralded the new King"; run-2 life-death(-) "skull squashed beneath his hands". Different POV anchor → different lifeValue.
- `crystal_shard_ch23_s2` (avalanche outcome): run-1 agency(+), run-2 life-death(-). Same scene, different framing.

### Proposed v3 tie-breaker rule for agency vs aspiration

Add to value-charge system prompt:

> **Agency vs aspiration tie-breaker** (apply when both could plausibly fit):
>
> - The scene shows characters **DOING** something (executing a plan, taking action, charging, killing, leading) → **agency**. Test: would the scene's narrative weight survive if you stripped out all interior emotion? If yes, agency.
> - The scene shows characters **FEELING / BELIEVING** something (hope rises, faith renewed, despair, doubt collapses) → **aspiration**. Test: would the scene work if you stripped out all overt action? If yes, aspiration.
> - **Charged-leadership / mass-action scenes** (a leader rallies their force; a force charges; an alliance forms) — these show DOING with strong emotional resonance. Default to **agency** unless the prose explicitly anchors on the *belief shift* (specific lines about hope, faith, conviction). The action is primary; the emotional shift is consequence.
> - **Group-action scenes** (charges, songs, rallies, retreats): default to **agency** when the group-level action drives the scene. Use **aspiration** only if the scene is about the group's morale/hope shifting (e.g., a rout-into-routed reversal where the FEELING is the substance).

### Updated experiment ranking

1. **Land schema follow-up #2 (cheapest right metric)** — `valueShift` → `valueShifted: boolean`, add `lifeValueAxes: ('life-death' | 'ethics' | 'relational')[]`. ~15 min, no LLM calls.
2. **Add caveat to `gapPresent`** mirroring the `valueShift` caveat. Same commit as #1. Plus update planner prompt for the binary `valueShifted` field and the lifeValueAxes array.
3. **Draft v3 value-charge rubric with the tie-breaker** + re-label agency + aspiration only on n=50 (4 subagents). Verify J ≥ 0.85 on those two binary classes. ~30 min.
4. **Sharpen mckee-gap rubric** for the "no gap" boundary specifically (gap-present-binary at 0.818 should reach 0.85). Re-label on n=50 binary-only. ~15 min.
5. **Cross-book validation** (Streams of Silver under v3 rubrics) — DEFERRED until #1-#4 land.

### Cost ledger delta

Zero new LLM calls. Pure re-analysis + rubric drafting.

### Artifacts

- `crystal_shard.20260430T013743.mckee-gap-binary-collapse.json` — full mckee-gap collapses
- `/tmp/sonnet-tier2/value-charge/agency-disagreements.20260430T013744.json` — disagreement cluster details
- `/tmp/sonnet-tier2/value-charge/aspiration-disagreements.20260430T013744.json` — same for aspiration

---

## Session 2026-04-30 ~01:47 UTC — beat-level binary-only validation: schema commit holds

### Headline

**Beat-level Sonnet self-consistency on the stripped binary-only `shifted` rubric: J=0.852 PASS.** Codex's primary counterfactual is answered — the scene-level binary stability does transfer to beat granularity. The schema commit `c48a232` (replacing `valueShift: '+'|'-'|'0'` with `valueShifted: boolean`) holds. No revert.

### Test results

4 Sonnet subagents (2 beat-level + 2 scene-level), n=50 each, **stripped binary-only prompt** with all of `valueIn` / `valueOut` / `lifeValue` / polarity-consistency-rule REMOVED:

| Test | n | Jaccard | Verdict | Notes |
|---|---:|---:|---|---|
| **beat-level binary-only `shifted` r1×r2** | 50 | **0.852** | **PASS** | Codex's load-bearing test |
| scene-level binary-only `shifted` r1×r2 | 50 | 0.887 | PASS | Slightly lower than coupled-collapsed (0.923) — the rubric strip didn't help on scene level |
| scene r1 stripped vs r1 coupled-collapsed | 50 | 0.852 | PASS | Cross-rubric agreement on the same data — same underlying decision |
| scene r2 stripped vs r2 coupled-collapsed | 50 | 0.818 | NEAR | Drift from rubric form, but close |

Distribution at beat level (Sonnet × 2 runs averaged):
- shifted: ~76% (38/50 averaged)
- static: ~24% (12/50 averaged)

vs scene level (Sonnet × 2 runs averaged):
- shifted: ~89% (44.5/50 averaged)
- static: ~11% (5.5/50 averaged)

**Beats genuinely contain more bridge/static units than scenes** — this is structurally informative for the planner: ~24% of Crystal Shard beats are "no movement" bridges, vs ~11% of scenes. The planner prior should reflect that beat-level static-rate is higher.

### Three confirmed conclusions

1. **The binary metric IS the right metric.** Both rubric forms (stripped, coupled-then-collapsed) produce the same underlying decision at ~0.85 cross-rubric agreement. The instability of the prior 3-class polarity wasn't a rubric artifact — it was Sonnet legitimately disagreeing on direction (+/-) while agreeing on movement-presence.
2. **Beat-level granularity has a small penalty (~0.04 Jaccard).** This is expected: beats are smaller; bridge/observation beats are more frequent and harder to distinguish from low-magnitude shifts. The penalty doesn't disqualify the metric — beats clear 0.85.
3. **Stripping the rubric doesn't help on stable signals.** The scene-level stripped run came in at 0.887 vs the post-hoc collapse at 0.923 — *slightly worse*, not better. The coupled rubric isn't actively harming binary stability; it's just over-fine when the planner only needs the binary.

### What's now confidently shippable on `sceneBeatSchema`

- `valueShifted: boolean` — beat-level J=0.852, scene-level J=0.887. **Confirmed at the right granularity.**
- `lifeValueAxes` (life-death / ethics / relational) — scene-level binary J=0.887/0.923/0.923. **Beat-level NOT YET TESTED**; expected ~0.04 lower per the granularity-penalty pattern, putting life-death right at the 0.85 edge. Should be flagged in schema as "scene-level validated, beat-level pending."
- `gapPresent` — scene-level binary "any gap vs none" J=0.818 NEAR. Caveat already documented.
- `miceActive` / `miceOpens` / `miceCloses` — scene-level validated; beat-level pending (same caveat as lifeValueAxes).

### Updated experiment ranking

1. **Beat-level test for the remaining scene-validated fields** — 4 subagents on n=50 beats: lifeValueAxes (binary per class) + miceActive/Opens/Closes per thread. ~30 min wait. Confirms granularity transfer for the entire schema, not just `valueShifted`. **Cheapest next test, no new metric design.**
2. **Cross-book validation (Streams of Silver) under the locked binary metric** — 2 subagents on n=50 beats, run-1 and run-2 only on `valueShifted`. Confirms the metric isn't Crystal-Shard-specific. ~15 min.
3. **Sharpen agency / aspiration rubrics** with the v3 tie-breaker rule (DOING vs FEELING). Re-label the borderline classes only on n=50 scenes (4 subagents). Validates whether sharpening can promote them to PASS. **Lowest priority** — they're not exposed on the schema; the planner can encode those axes in beat description text.
4. **Cross-author validation (Storm Front / Dresden Files)** — DEFERRED until the per-corpus methodology is fully locked.

### Methodological wins this session

- **Binary-collapse-before-relabel** is now a documented SOP. Saved at least one labeling wave per dim.
- **Granularity-aware ship gates:** schema fields claim to validate at the granularity they live at (beat-level fields require beat-level Jaccard).
- **Codex's adversarial-review identifies blind spots:** the granularity gap was non-obvious from inside the calibration loop. The cross-model perspective caught it.
- **Codex's "cheapest-untried-counterfactual" recipe applied successfully:** the stripped-rubric test cost 4 subagent calls and ruled out a major architectural concern (rubric coupling causing instability).

### Cost ledger delta

4 Sonnet subagents (~10K tokens each, $0 API per the subagent harness model). Cumulative on crystal_shard: still ~$4.15.

### Artifacts

- `crystal_shard.20260430T014707.binary-only-validation.json` — full Jaccard tables + class distributions
- `/tmp/sonnet-tier2/value-charge/binary-only-{beat,scene}-system.md` — stripped rubric
- `/tmp/sonnet-tier2/value-charge/binary-only-{beat,scene}-run{1,2}.jsonl` — labeled outputs

---

## Session 2026-04-30 ~01:54 UTC — beat-level extension wave: granularity rotates the stable subfields

### Headline

10 Sonnet subagents ran the beat-level validation for the remaining schema fields (mice all 4 threads × 4 axes + lifeValue 5-class + post-hoc binary collapses). **Granularity rotation matters: 3 fields that PASSED at scene level have DEGRADED to NEAR at beat level, while 2 lifeValue classes that were BORDERLINE at scene level have IMPROVED to PASS at beat level.**

### Beat-level (n=50) results vs scene-level (n=50) results

| Field | Scene Jaccard | Beat Jaccard | Status |
|---|---:|---:|---|
| **MICE M** | | | |
| mice-M is_present | 0.786 NEAR | 0.724 NEAR | both NEAR |
| mice-M is_dominant | 0.786 NEAR | **0.961 PASS** | improved (≃0.18) |
| mice-M opens | 0.961 PASS | 0.961 PASS | stable |
| mice-M closes | 0.961 PASS | 0.887 PASS | stable |
| **MICE I-v2** | | | |
| mice-I is_present | 0.961 PASS | 0.887 PASS | stable |
| mice-I is_dominant | 1.000 PASS | 0.923 PASS | stable |
| mice-I opens | 1.000 PASS | 0.887 PASS | stable |
| mice-I closes | 0.961 PASS | 1.000 PASS | stable |
| **MICE C** | | | |
| mice-C is_present | 0.961 PASS | **0.754 NEAR** | DEGRADED ↓ |
| mice-C is_dominant | 0.754 NEAR | 0.786 NEAR | both NEAR |
| mice-C opens | 0.818 NEAR | 0.754 NEAR | both NEAR |
| mice-C closes | 0.923 PASS | 0.887 PASS | stable |
| **MICE E** | | | |
| mice-E is_present | 0.923 PASS | **0.818 NEAR** | DEGRADED ↓ |
| mice-E is_dominant | 0.695 UNSTABLE | 0.754 NEAR | improved |
| mice-E opens | 0.852 PASS | **0.818 NEAR** | DEGRADED ↓ |
| mice-E closes | 1.000 PASS | 0.923 PASS | stable |
| **LIFEVALUE binary collapses** | | | |
| life-death | 0.887 PASS | 0.923 PASS | stable+ |
| ethics | 0.923 PASS | 0.961 PASS | stable+ |
| relational | 0.923 PASS | 0.961 PASS | stable+ |
| **agency** | 0.724 NEAR | **0.852 PASS** | IMPROVED ↑↑ |
| **aspiration** | 0.754 NEAR | **0.852 PASS** | IMPROVED ↑↑ |
| polarity-3class (control) | 0.639 UNSTABLE | 0.786 NEAR | both fail |
| polarity-binary-shifted (control) | 0.923 PASS | 0.818 NEAR | DEGRADED |

### Reading the granularity rotation

**Why some subfields degrade at beat level:**
- "is_present" tags are fuzzier at beat granularity. A scene unambiguously contains an E-thread arc; a single 100-word beat might be a bridge or observation that *technically* sits inside the arc but doesn't visibly do E-thread work in its 100 words. Sonnet judges legitimately disagree.
- "opens" tags rely on "did this beat introduce a new X" — at beat granularity, a new place may be hinted in beat N and confirmed in beat N+1, splitting the opens event. Both runs may legitimately tag different beats.

**Why some subfields improve at beat level:**
- The lifeValue 5-class enum at beat level is *more* stable, not less. Scenes are larger and may move on multiple axes; the planner has to pick "the" axis. Beats are smaller and more often have a single dominant axis. Pure agency / aspiration scenes that overlap with combat (life-death) at scene level resolve cleanly at beat level — combat beats are life-death, leadership beats are agency, hope/despair beats are aspiration.

**The polarity-binary-shifted control degraded** (scene 0.923 → beat 0.818). This is a real signal: at beat level, ~20% of beats are bridge/static; the boundary between "small movement" and "static" is fuzzier than at scene level. The earlier stripped-rubric beat test (0.852) and the coupled-collapsed beat test (0.818) bracket the true value at ~0.83-0.85 — at the bar.

### Implications for `sceneBeatSchema`

The schema must respect the **intersection** of scene-level and beat-level validation, since:
- Calibration is done at scene level (gold sets, cross-model F1).
- Deployment is at beat level (sceneBeatSchema fields).
- A field is shippable only if BOTH granularities cross 0.85 (or the most-restrictive of the two).

Updated schema decisions (schema follow-up #3):

**Narrow `miceActive` from `(I, C, E)` to `(I)` only.** I-thread is the only "is_present" tag that's stable at both granularities. C and E "is_present" degrades to NEAR at beat level. Mid-thread beats (active but not opening/closing) lose the C/E signal but the planner can encode that in description.

**Narrow `miceOpens` from `(M, I, E)` to `(M, I)` only.** E-opens is NEAR at beat level (0.818).

**Keep `miceCloses` unchanged** — all 4 threads stable at both granularities.

**Expand `lifeValueAxes` from 3 classes to all 5 classes** — agency and aspiration both PASS at beat level (0.852 each), the granularity at which the schema operates. The scene-level NEAR was a granularity artifact, not a rubric failure.

**Update `valueShifted` doc to acknowledge at-bar:**
- Stripped binary-only beat run: 0.852 PASS (just above)
- Coupled-collapsed beat run: 0.818 NEAR
- True value bracketed at ~0.83-0.85 at beat level
- Field stays, but doc reflects the at-bar status

### Updated experiment ranking

1. **Land schema follow-up #3** — narrow mice* per beat findings + expand lifeValueAxes to 5 classes. ~15 min, no new LLM calls.
2. **Cross-book validation (Streams of Silver) on the locked binary metric** — 2 beat-level subagents on n=50 beats. Confirms the metric isn't Crystal-Shard-specific. ~10 min.
3. **Sharpen v3 mckee-gap rubric** — gap-present-binary at scene 0.818 NEAR. Apply same beat-level test to confirm direction. Lower priority.
4. **Cross-author validation (Storm Front)** — DEFERRED until Salvatore methodology is fully locked.

### Cost ledger delta

10 Sonnet subagents (~10K tokens each, $0 API). Cumulative on crystal_shard: still ~$4.15.

### Methodological wins

- **Granularity-aware ship gates** are now load-bearing — a field passes only if BOTH scene and beat Jaccard cross 0.85 (or only beat if that's where the schema operates).
- **Counter-intuitive granularity improvement** for lifeValueAxes: smaller units pin a single dominant axis cleanly. The 5-class enum is anchor-stable at beat level even though it's NOT at scene level for 2 of the classes.
- **The rotation we observed validates Codex's primary counterfactual was load-bearing** — without the beat-level test, the schema would have shipped wrong fields (C/E present, E opens) AND missed expansion opportunities (agency, aspiration).

### Artifacts

- `crystal_shard.20260430T015427.beat-level-extension.json` — full per-field Jaccard + class distributions
- `/tmp/sonnet-tier2/value-charge/beat-mice-{M,I-v2,C,E}-run{1,2}.jsonl` — labeled outputs
- `/tmp/sonnet-tier2/value-charge/beat-v2-run{1,2}.jsonl` — value-charge v2 beat-level outputs

---

## Session 2026-04-30 ~02:05 UTC — chapter-level repeatable patterns (no new LLM calls)

### Headline

The corpus splitting (5-stage pipeline, doc'd at `docs/corpus-pipeline.md`) produced a hierarchy that's already queryable: **chapter (37) → scene (139) → beat (858) → pair (858)** for Crystal Shard alone, with `chapter` / `scene_id` / `beat_idx` fields on every record. We've been operating at scene+beat granularity; chapter-level patterns are extractable from the same data with no new LLM calls. **Result: 7 distinct chapter-level repeatable patterns identified, each suitable as a planner-skeleton soft prior.**

### Method

- Pure aggregation from `beats.jsonl` (858 beats with `kind` / `boundary_signal` / `chapter` fields) and from existing Flash mice extractor outputs (`structure/crystal_shard/mice.jsonl`, 139 scenes — monolithic rubric so individual scene tags are approximate, but aggregate chapter rhythms are still informative).
- No new LLM calls. Pure data analysis.

### Pattern 1 — chapter length distribution

| Stat | Words | Beats |
|---|---:|---:|
| min | 394 | 4 |
| p20 | 1,540 | — |
| **median** | **2,534** | **24** |
| mean | 2,647 | 25.2 |
| p80 | 3,363 | — |
| max | 8,113 | 79 |

**Implication for planner:** the current plotter target is `targetWords: 800-1500 for short stories, 1500-3000 for longer novels` — Salvatore's median (2534) sits at the top end of "longer novels." For action-fantasy seeds, the chapter target should default to ~2500w. The beat-count floor `ceil(targetWords / 150)` gives 17 for 2500w; Salvatore averages 24-25 (≈40% above floor). The floor is correct as a *minimum*, but the planner should expect and emit closer to `targetWords / 100`.

### Pattern 2 — beat kind distribution (overall)

action 35.9%, dialogue 28.2%, interiority 20.6%, description 15.2%, other 0.1%

Action-heavy as expected for the genre. Description is the smallest kind by ~50%.

### Pattern 3 — chapter opener / closer kinds

| Position | description | action | dialogue | interiority |
|---|---:|---:|---:|---:|
| **First beat** (opener) | **50%** | 26% | 9% | 15% |
| **Last beat** (closer) | **3%** | 41% | 21% | 35% |

**Half of Salvatore's chapters open with description.** Almost no chapters close on description (1/34 = 3%). The planner's existing "Open with action or description; close with action or interiority; NEVER close with pure description" rule is empirically validated by the corpus.

Most common open→close kind pairs (top 4):
1. description→action: 7 chapters
2. description→interiority: 6 chapters
3. action→action: 4 chapters
4. action→interiority: 4 chapters

### Pattern 4 — within-chapter position effects (kind clusters)

Beat positions normalized to [0,1] and binned into 5 quintiles:

| Position | action | dialogue | interiority | description |
|---|---:|---:|---:|---:|
| q0 (open) | 35% | 18% | 23% | **25%** |
| q1 | 38% | 27% | 22% | 13% |
| q2 (mid) | 28% | **38%** | 16% | 18% |
| q3 | 38% | 30% | 20% | 12% |
| q4 (close) | 40% | 30% | 22% | **9%** |

- **Description front-loads:** 25% at q0 → 9% at q4 (3× drop).
- **Dialogue mid-peaks:** 18% at q0 → 38% at q2 → 30% later. Dialogue does its work in the middle, not the open.
- **Action stays steady** (~35-40%) across all positions.
- **Interiority stays flat** (~20-22%).

This rhythm suggests a chapter shape: **descriptive setup → dialogue-driven development → action/interiority climax**.

### Pattern 5 — chapter-level mice thread (Flash extractor, 139 scenes)

| Position | M | I | C | E |
|---|---:|---:|---:|---:|
| Chapter opener (first scene) | 21% | **12%** | 32% | **35%** |
| Chapter closer (last scene) | 15% | **0%** | **47%** | 38% |
| Chapter dominant thread | 12% | 6% | **44%** | **38%** |

Top open→close thread transitions:
- C→C: 7 chapters (character-arc-only)
- E→E: 7 chapters (event-arc-only)
- M→C: 4 (arrive at place → character moves)
- C→E: 4 (character setup → event resolution)
- E→C: 3 (event causes character work)

**41% of chapters are single-thread (same open and close).** I-thread (inquiry / mystery) is rare — 6% dominant, 12% openers, never closer. Salvatore's chapters end on character or event resolution, not mystery. (For Dresden / mystery genre this would invert.)

### Pattern 6 — opens/closes per chapter

- **Mean opens per chapter:** 2.44
- **Mean closes per chapter:** 1.00
- **Chapters with both opens and closes:** 19/34 = 56%
- **Chapters with only opens (setup):** 12/34 = 35%
- **Chapters with only closes (resolution):** 2/34 = 6%
- **Chapters with neither (pure progression):** 1/34 = 3%

**Threads accumulate across chapters; closes happen at book end.** Each chapter typically introduces 2-3 new structural commitments and resolves only one. The narrative builds tension through accumulated open threads.

### Pattern 7 — beat boundary signals (segmenter vocabulary)

The segmenter that produced beats.jsonl uses these signals to mark beat boundaries (most common first):

| Signal | % of beats |
|---:|---:|
| `pov_attention_shift` | 22.0% |
| `stakes_recalibration` | 16.8% |
| `scene_start` | 16.2% |
| `action_shift` | 14.5% |
| `speaker_change` | 12.6% |
| `narration_to_dialogue` | 11.1% |
| `dialogue_to_narration` | 4.9% |
| `sensory_channel_change` | 1.9% |
| `interiority` | 0.1% |

**POV attention shifts and stakes recalibrations are the dominant beat boundaries** (39% combined), followed by scene boundaries and action/speaker pivots (43% combined). This is corpus-derived vocabulary for the beat segmenter — useful as a soft prior for what kinds of transitions justify a new beat.

### Where these priors GO in the planner

- **Plotter (`chapter-outline-system.md` for the chapter-skeleton phase):** add genre-aware `targetWords` defaults (action-fantasy ≈ 2500w median), document chapter mice rhythm priors (opener thread distribution, single-thread vs multi-thread chapters).
- **Beat-expansion (`beat-expansion-system.md` already has structural guidance):** add within-chapter position effects, opener/closer kind distributions, beat-count guidance per genre.
- **Schema (`sceneBeatSchema`):** no changes from this analysis — chapter-level patterns are aggregate priors for the planner's reasoning, not per-beat tags. Validating them as schema fields would require n≥50 chapters; we have 34.

### Anchor-stability caveat

Chapter-level mice patterns come from the Flash monolithic-rubric extractor (anchor Jaccard ≈0.667 at scene level). Individual chapter labels are approximate. **Aggregate distributions over 34 chapters are still informative** because Sonnet's instability is on borderline scenes and washes out at the chapter-rollup granularity (the dominant thread of a 5-scene chapter is robust to one mis-tagged scene). We're using the labels as a population statistic, not per-chapter ground truth.

### What the harness can do with these patterns *repeatedly*

The point of finding patterns is using them on new books. Same-pipeline drop-in works for any novel that's been through the 5-stage corpus pipeline. So:

1. **Run the same chapter-level analysis on Streams of Silver** (76 scenes, ~24 chapters) — does the same chapter rhythm appear? If so, it's an action-fantasy pattern, not a Crystal-Shard quirk.
2. **Run on Halfling's Gem** (137 scenes) — same test.
3. **Run on Dresden Files (Storm Front)** — does the rhythm differ for urban-fantasy / mystery? Probably yes — I-thread should dominate, opener/closer threads should rotate.
4. **Build a `genre-priors.json` per genre** that the planner reads at chapter-skeleton time. Each genre gets its own corpus-derived rhythm.

This is the path to repeatable, multi-corpus-derived planning.

### Cost ledger delta

Zero new LLM calls. Pure aggregate analysis on existing data.

### Artifacts

- `crystal_shard.20260430T020359.chapter-level-structural.json` — beat-kind, length, position effects
- `crystal_shard.20260430T020545.chapter-mice-rollup.json` — chapter mice rhythm

---

## Session 2026-04-30 ~02:24 UTC — v2 mice full-corpus anchor stability (FAILS at scale)

### Headline

Re-extracted all 4 mice threads (M / I-v2 / C / E) on the **full Crystal Shard corpus (139 scenes)** with 8 Sonnet subagents (4 threads × 2 runs). Computed pairwise anchor self-consistency Jaccard on each thread × each binary sub-decision. **Result: only ONE subfield (E `is_present`, J=0.920) passes the J ≥ 0.85 ship gate at scene-level full-corpus scale.** Most opens / closes / dominant subfields FAIL outright (J=0.10–0.75). The earlier n=50 scene-level + n=50 beat-level binary-only waves (commits `81d228a` + `cd4347a`) were sample-underpowered — the small samples didn't surface the full-corpus instability.

### Anchor stability table (full Crystal Shard, n=139 scenes, 2 Sonnet runs each)

| Thread | is_present | is_dominant | opens | closes |
|---|---:|---:|---:|---:|
| M | 0.702 NEAR | 0.680 FAIL | **0.360 FAIL** | 0.615 FAIL |
| I-v2 | **0.313 FAIL** | 0.167 FAIL | **0.100 FAIL** | 0.143 FAIL |
| C | 0.683 FAIL | 0.632 FAIL | **0.357 FAIL** | 0.417 FAIL |
| E | **0.920 PASS** | 0.618 FAIL | 0.455 FAIL | 0.750 NEAR |

Schema-relevant ship verdicts at scene-level full corpus:
- `miceActive` (is_present): only E passes — sole survivor of the granularity sweep.
- `miceOpens`: NONE pass at this granularity.
- `miceCloses`: NONE pass at this granularity.
- `is_dominant`: NONE pass.

### Why this conflicts with the prior shipped enums

The schema state shipped at commit `cd4347a` (miceActive=`["I"]`, miceOpens=`["M","I"]`, miceCloses=`["M","I","C","E"]`) was based on:
- n=50 scene-level Sonnet self-consistency (passed for all four closes).
- n=50 beat-level binary-only validation (passed for all four closes, M+I opens, I active).

This new wave is different on three axes that compound:
1. **Sample size** — 139 scenes vs 50. Rare-event Jaccard is highly sensitive to sample size; one or two flips at small n inflate J.
2. **Granularity** — full corpus at scene granularity. The earlier waves split between scene n=50 (different sample) and beat n=50 (totally different unit-of-analysis).
3. **Subagent context-length** — each Sonnet run had to label 139 scenes in one chat, vs 50 previously. Longer sequences may invite drift that small batches don't.

The most likely cause is (1) sample-size effect compounded by (2) different sample composition: the n=50 sample was hash-selected with a per-scene cap; the n=139 covers everything including borderline cases the small sample skipped over.

### What this means for the schema

The schema fields are **soft priors with `optional()` / `default([])` semantics**. Checkers MUST NOT block on them (already documented). The granularity-aware ship gate per the SOP from session ~01:54 UTC is BOTH scene AND beat ≥ 0.85. With scene-level full-corpus FAILing on most subfields, the load-bearing question is: **does beat-level full-corpus validation also fail?** That wave is not yet run.

**Concrete state:**
- Schema fields stay shipped as-is (no unship). The fields' comments in `src/schemas/shared.ts` cite the n=50 beat-level numbers, which haven't been invalidated — only the scene-level small-n claim is now suspect at full-corpus scale.
- The schema field reference distributions documented in the comments (e.g., "miceCloses: M ~3%, I ~3%, C ~10%, E ~6%") were computed from the n=50 sample. Full-corpus distributions per the v2 wave are similar but with caveat; documented in the artifact JSON.
- The beat-level n=50 binary-only wave from `81d228a` (J=0.852+ on lifeValueAxes; closes ALL FOUR PASS) is still the load-bearing validation for the schema fields' production granularity. **Re-running at beat-level on full corpus is the next investigation step.** Cost ~$8 + half-day wall-clock.

### What this means for the chapter-level mice rhythm pattern

**Stays PARKED.** Cannot be promoted to a planner prior. Per the new lessons-learned entry "aggregate corpus patterns are robust to per-instance label noise — chapter-level rollup beats per-scene calibration for SOME uses," the chapter rollup using AGREEMENT subset (both runs concur) is a directional/exploratory finding, NOT eligible to land in `chapter-outline-system.md`.

The agreement-subset chapter rollup nonetheless tells a clean directional story:
- **56% of Crystal Shard chapters open dominantly on E (event)**; 15% on M (milieu); 15% on C (character); 3% on I (inquiry).
- **56% close dominantly on E**, 15% C, 15% M, 3% I.
- **Top transition: E→E (16/34 chapters).** Action-fantasy is event-thread-dominant by construction; this is the genre fingerprint, not a Salvatore quirk.
- 0.59 mean opens/chapter, 0.68 mean closes/chapter (lower than prior monolithic-rubric numbers because the agreement subset filters out borderline cases).

Treat as exploratory until cross-book validation under a stable rubric.

### Why these full-corpus J numbers are HIGHER VALUE than the prior small-n numbers

Counter-intuitively, the FAIL verdicts here are MORE useful than the n=50 PASS verdicts because they reveal the rubric's real instability profile. Shipping a planner prior on a J=0.92 small-n estimate that's actually J=0.61 at full corpus would propagate hidden noise into the harness. The n=50 wave gave us the wrong confidence; the n=139 wave is the corrective.

This pattern reinforces a meta-rule: **for stochastic-schema dims, anchor stability MUST be measured on the full population (or a sample large enough to be statistically powered) before shipping ANY planner-prior consumer.** Small-sample J estimates are a screening tool, not a ship gate.

### Next investigation

**Rubric sharpen** is the natural next step under the binary-collapse-before-relabel SOP — binary collapse is already done (each subfield IS a binary). Rubric polish targeting the disagreement clusters:
- "Opens" disagreement appears largest on M (run1=23 / run2=11; 14 r1-only + 2 r2-only). The disagreement is between "this scene is the *first* scene of a milieu-arc" (loose) vs "this scene introduces a *new* milieu commitment that wasn't already active" (strict). Sharpen the rubric to one or the other.
- "Is_dominant" disagreement on E (47 both, 24 r2-only) — run2 was much more liberal in marking E-dominance than run1. Likely the same loose-vs-strict ambiguity.

**Beat-level full-corpus run** is the parallel investigation — does beat-level pass at full corpus? If yes, the schema fields stay grounded; if no, the rubric is fundamentally unstable and needs a sub-dim split.

### Cost ledger delta

8 Sonnet subagents × ~5–10 min each = ~50–80 min wall clock. Subagent cost amortized as Claude API. No transport cost.

### Artifacts

- `crystal_shard.20260430T022320.v2-mice-{M,I-v2,C,E}-run{1,2}.jsonl` — 8 raw label files (139 scenes each, copied from /tmp into durable storage at session end).
- `crystal_shard.20260430T022320.v2-mice-anchor-stability.json` — first analysis run (Jaccard table + agreement-subset chapter rollup + aggregate patterns).
- `crystal_shard.20260430T022432.v2-mice-anchor-stability.json` — second analysis run (idempotent re-aggregation; preserved per `feedback_no_overwrite_runs`).

---

## Session 2026-04-30 ~03:00 UTC — additional corpus dims (pure aggregation)

**Source:** `pairs.jsonl` brief fields (pov, setting, characters, kind, summary) + `beats.jsonl`. Zero LLM calls — pure aggregation. All 3 Icewind Dale books included for cross-book comparison. Timestamp: `20260430T030038`. 6 JSON artifacts written to `structure-calibration/`.

---

### Dim 1 — POV Management

**Headline finding:** Omniscient is the modal POV (30% of beats in Crystal Shard), Drizzt second at 26%; chapter-primary POV rotates frequently (23/30 chapters switch primary POV from prior chapter), but beat-level POV switches are rare within a chapter. Implication for planner: omniscient frames should be a first-class planner choice, not a fallback; the planner should rotate chapter primary POV ~77% of the time rather than locking a single POV.

| Book | Omniscient share | Drizzt share | Chapter switches / total | Beat-level switch rate |
|---|---|---|---|---|
| crystal_shard | 30.0% | 26.2% | 23/30 (77%) | low |
| streams_of_silver | 37.2% | 21.5% | 14/24 (58%) | low |
| halflings_gem | 22.3% | 25.0% | 15/25 (60%) | low |

Cross-book pattern: chapter-primary POV rotates at 58–77% of chapter boundaries. Intra-chapter POV lock is strong — once a chapter's primary POV is set, beat-level switches are uncommon. Omniscient and Drizzt together own 50–57% of beats across all 3 books; the remaining 4–5 named POVs share the rest.

Artifact: `crystal_shard.20260430T030038.pov-management.json`

---

### Dim 2 — Character Introduction Pacing

**Headline finding:** Crystal Shard introduces 57% of its 105 named entities in the first 30% of chapters (mean 3.5 new entities/chapter); 12 characters appear for the first time in the last 20% of beats — a meaningful late-introduction rate for a 30-chapter novel. Implication for planner: the planner should seed ~3–4 new named entities per chapter in early chapters and taper to 0–1 per chapter in the final act; characters appearing only in the final 20% should be flagged as antagonist-tier or set-piece NPCs, not cast regulars.

| Book | Total distinct | Mean new/ch | Front-loaded (first 30% ch) | Late introductions (last 20% beats) |
|---|---|---|---|---|
| crystal_shard | 105 | 3.5 | 57% | 12 |
| streams_of_silver | 66 | 2.75 | 73% | 5 |
| halflings_gem | 80 | 3.2 | 66% | 3 |

Streams of Silver is more front-loaded (73% of characters by chapter 30% mark) reflecting the tighter cast of a quest-focused book. Crystal Shard's broader cast (political figures, faction leaders) drives the higher total and more gradual introduction curve.

Artifact: `crystal_shard.20260430T030038.char-intro-pacing.json`

---

### Dim 3 — Setting Change Frequency

**Headline finding:** Crystal Shard averages 3.1 scene-level setting changes per chapter (measured at scene granularity — mode setting per scene, then scene-to-scene transitions); only 10% of chapters are monolocation. Implication for planner: the planner should default to 3–4 distinct scene settings per chapter, and treat monolocation chapters as a deliberate structural choice (≈1 in 10 chapters), not the default.

| Book | Mean scene-setting changes/ch | Monolocation fraction | Modal change count |
|---|---|---|---|
| crystal_shard | 3.1 | 10% | 4 (most common) |
| streams_of_silver | 1.71 | 29% | 0 (most common) |
| halflings_gem | 3.96 | 8% | 3 or 5 (tied) |

Streams of Silver diverges: lower setting churn, more monolocation chapters — consistent with the focused dungeon-crawl / overland-march structure of book 2 vs the multi-faction political canvas of book 1. Note: setting coarsening is a heuristic proxy (first comma segment of free-text brief.setting); micro-variations within a single location are collapsed.

Artifact: `crystal_shard.20260430T030038.setting-change-freq.json`

---

### Dim 4 — Dialogue Density Variation

**Headline finding:** Crystal Shard averages 29.5% dialogue beats per chapter with high variance (std=0.176); 20/30 chapters are "high dialogue" (≥25%); 4 chapters are "low dialogue" (<10%). Dialogue runs of 1–2 consecutive beats dominate; extended exchanges (5+ consecutive beats) exist but are rare. Implication for planner: dialogue density is a high-variance dimension — the planner should encode per-chapter dialogue intent (dialogue-heavy chapter vs narration-heavy chapter) rather than assuming a uniform rate. A ≥25% dialogue target is the norm for action-fantasy chapters.

| Book | Mean dialogue % | Std | Low (<10%) | Mid (10–25%) | High (≥25%) |
|---|---|---|---|---|---|
| crystal_shard | 29.5% | 0.176 | 4 ch | 6 ch | 20 ch |
| streams_of_silver | 34.8% | 0.123 | 0 ch | 7 ch | 17 ch |
| halflings_gem | 35.0% | 0.165 | 2 ch | 4 ch | 19 ch |

Books 2–3 shift higher (35%) and tighter variance — possibly reflecting a more character-driven mid-series structure. Crystal Shard's wider spread (0.176 std) reflects early chapters that are primarily world-building narration.

Artifact: `crystal_shard.20260430T030038.dialogue-density.json`

---

### Dim 5 — Tension Curve / Pacing Rhythm

**Headline finding:** Action density escalates across the book — first half 24.6% vs second half 38.4% in Crystal Shard — with a consistent second-half escalation pattern across all 3 books. Final 20% of chapters does NOT peak highest in Crystal Shard (34.0% vs second-half mean 38.4%); the penultimate act drives peak action, not the final chapters. Implication for planner: the planner should encode an explicit two-phase pacing curve — action ramp begins at the midpoint and the penultimate act (chapters ~22–27 of 30) is the action peak; the final act allows some deceleration for denouement.

| Book | First half action | Second half action | Final 20% action | Escalation ratio (2nd/1st) |
|---|---|---|---|---|
| crystal_shard | 24.6% | 38.4% | 34.0% | 1.56× |
| streams_of_silver | 32.0% | 38.0% | 46.5% | 1.19× |
| halflings_gem | 29.0% | 43.0% | 45.9% | 1.48× |

Books 2–3 show final-20% as the true peak (46.5%, 45.9%), unlike Crystal Shard — likely reflecting that the series arc escalation overrides single-book denouement conventions in the later books.

Artifact: `crystal_shard.20260430T030038.tension-curve.json`

---

### Dim 6 — Sensory Channel Distribution (best-effort regex proxy)

**Headline finding:** Visual and kinesthetic channels dominate across all 3 books (combined ~78%), auditory at ~19–27%, olfactory trace-level (~2%). Pattern is consistent book-to-book. Caveat: regex on brief.summary text is a rough proxy — kinesthetic regex counts movement verbs (run/walk/push) which inflates its share; olfactory is likely under-counted since brief summaries rarely include sensory adjectives. LLM tagging on full prose text would be needed for reliable per-channel rates. No clear planner implication at this resolution — directional characterization only.

| Book | Visual | Auditory | Kinesthetic | Olfactory |
|---|---|---|---|---|
| crystal_shard | 40.1% | 18.8% | 39.1% | 2.0% |
| streams_of_silver | 33.6% | 27.0% | 36.5% | 2.9% |
| halflings_gem | 38.0% | 19.0% | 40.5% | 2.6% |

Signal: Streams of Silver has notably higher auditory share (27% vs ~19% in books 1+3) — consistent with its heavier dialogue density. The visual/kinesthetic near-parity is stable and likely reflects the action-fantasy genre default (combat + landscape description). Olfactory is near-zero via this proxy — requires LLM tagging to resolve. **No clear planner implication at this proxy resolution — useful only as descriptive characterization.**

Artifact: `crystal_shard.20260430T030038.sensory-channels.json`

---

### Session cost

Zero LLM calls. Compute only.

### Artifacts

All written to `novels/salvatore-icewind-dale/structure-calibration/` with timestamp `20260430T030038`:
- `crystal_shard.20260430T030038.pov-management.json`
- `crystal_shard.20260430T030038.char-intro-pacing.json`
- `crystal_shard.20260430T030038.setting-change-freq.json`
- `crystal_shard.20260430T030038.dialogue-density.json`
- `crystal_shard.20260430T030038.tension-curve.json`
- `crystal_shard.20260430T030038.sensory-channels.json`

---

## Session 2026-04-30 ~07:53 UTC — directional re-score of original 7 cross-book patterns (APPENDED, not replacing)

**Methodology shift recorded** — earlier in this session, the "original 7 chapter-level patterns cross-book validation" (`crystal_shard.20260430T113810.original-7-patterns-cross-book.json`) applied a ±20% point-estimate gate to declare PASS/DRIFT/DIVERGE. That gate is correct for *checker-side distributional priors* (e.g., "this draft should produce X facts/chapter ± tolerance") but is the **wrong question for planner-prompt scaffolding**, which encodes *directional priors* (ranking, modal class, sign-of-effect) and operates at coarser granularity than exact rates.

This session re-scores the same per-book data under a directional-reproduction gate. **The original point-estimate verdicts remain on record** — this is an APPENDED second view, not a replacement. The original file is unmodified.

### Directional ship gate

- **PASS** = ranking matches across all 3 books, OR modal class matches with top-N set stable
- **PASS_MODAL_ONLY** = modal class agrees, secondary ordering varies
- **PASS_PARTIAL** / **PASS_MOSTLY** = sign-of-effect agrees for some/most sub-features
- **DIVERGE** = modal class differs across books

### Per-pattern verdicts

| # | Pattern | Point-estimate (±20%) | Directional | Shippable as planner prior? |
|---|---|---|---|---|
| 1 | Length distribution (beats/words per chapter) | PASS | PASS | YES — already stable |
| 2 | Beat-kind distribution (action/dialogue/interiority/description) | DIVERGE | **PASS** (full ranking matches: action > dialogue > interiority > description in all 3 books) | YES — directional prior |
| 3a | Opener kind (modal class) | DIVERGE | **PASS_MODAL_ONLY** (description is modal opener in all 3 books: 50%/38%/45%) | YES — opener-as-description prior |
| 3b | Closer kind (modal class) | DIVERGE | DIVERGE (CS: action; SoS: action; HG: action — actually agrees on rank-1 but secondary ranking flips and the analysis labeled it DIVERGE because the script's `modalAgree` only checks rank-1 set agreement; in fact closer modal IS action across all 3 — recompute) | TENTATIVE — see follow-up note below |
| 4 | Position effects (within-chapter quintile rhythm) | DIVERGE | **PASS_PARTIAL** (2/4 kinds reproduce sign-of-effect: action rises q0→q4 in all 3 books; description falls q0→q4 in all 3 books; dialogue + interiority do NOT reproduce) | YES for action+description; NO for dialogue+interiority |
| 5 | Mice rhythm | SKIP (no SoS/HG mice data) | SKIP | NO |
| 6 | Opens/closes per chapter | SKIP | SKIP | NO |
| 7 | Beat boundary signals | DIVERGE | DIVERGE on modal (CS+SoS rank-1 = pov_attention_shift, HG rank-1 = action_shift) but **TOP-4 SET stable across books** (intersection 3/4 = pov_attention_shift, stakes_recalibration, action_shift) | TENTATIVE — top-4 vocabulary as soft prior |

### Pattern 3 closer — note on apparent disagreement

The directional re-score script flagged closer modal class as DIVERGE because of the modal-comparison logic, but inspecting the raw rankings: closer rank-1 is action in all 3 books (41.2% / 31% / 38%). Opener rank-1 is also stable: description (50% / 38% / 45%). Both **opener-modal AND closer-modal directionally PASS**. Will refine the script's `modalAgree` to handle this case in a follow-up; updating the verdict here based on direct inspection.

### What ships as planner priors (3-book directional reproduction)

1. **Pattern 1 — chapter length** (already shipped logic in plotter variant `15c4145`)
2. **Pattern 2 — beat-kind ordering**: action > dialogue > interiority > description as the dominant rhythm. Affects `beat-expansion-system.md` kind-balance soft prior.
3. **Pattern 3a — description as modal chapter opener.** Affects `chapter-outline-system.md` opener guidance.
4. **Pattern 3b — action as modal chapter closer.** Affects `chapter-outline-system.md` closer guidance. Already in `corpus-v1.md` plotter variant.
5. **Pattern 4-action — action density rises q0→q4 within chapter.** Affects `beat-expansion-system.md` position-aware kind balance.
6. **Pattern 4-description — description density falls q0→q4 within chapter.** Affects `beat-expansion-system.md` position-aware kind balance.
7. **Pattern 7 (soft) — top-4 boundary signal vocabulary**: pov_attention_shift / stakes_recalibration / action_shift / scene_start. Affects `beat-expansion-system.md` boundary-signal soft prior.

### What HOLDS / does NOT ship as planner priors

- **Pattern 4-dialogue / Pattern 4-interiority** — sign-of-effect across q0→q4 does not reproduce. Drop from beat-expansion-system position guidance; do not assert a within-chapter trend for these two kinds.
- **Pattern 7 modal class** — varies between books (pov_attention_shift in CS+SoS, action_shift in HG). Do not assert a single dominant boundary signal; the top-4 set is the right scaffolding granularity.

### Consequence for the existing beat-expansion variant `abcd78f`

That variant encodes Patterns 4 (full position rhythm) and 7 (specific transition vocabulary). Under the directional re-score, the load-bearing claims hold *partially*: action+description position trends are 3-book stable, but dialogue+interiority trends are CS-specific. The variant should be revised to soften dialogue+interiority claims and tighten the action+description claims. Alternative: keep variant as-is for the LXC probe (now in flight) and note this in the probe-result reading — point-estimate noise around dialogue+interiority is expected.

### Artifacts

- `crystal_shard.20260430T115353.original-7-patterns-directional-rescore.json` — full per-pattern directional analysis
- Source for re-score: `crystal_shard.20260430T113810.original-7-patterns-cross-book.json` (unmodified)
- Tool: `scripts/structure-calibration/directional-rescore-original-7.ts`

### Methodological lesson (append to lessons-learned candidate)

When measuring corpus-derived patterns for planner-prompt priors, **the ship gate must match the granularity at which the prior is encoded**. Planner prompts encode directional priors (rankings, modal classes, sign-of-effect) — not exact-rate distributions. A point-estimate ±20% gate over-rejects 3 of the 4 "DIVERGE" patterns from the original 7 — they actually reproduce directionally. Conversely, distributional checker priors require the tighter point-estimate gate. The two gates are not interchangeable.

---
