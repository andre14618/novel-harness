---
status: active
updated: 2026-04-29
audience: someone adding a new corpus to the structural-decomposition pipeline
---

# Corpus Structural Decomposition — Walkthrough

This is the practical guide for running Stage 6 of the corpus pipeline on a new novel. If you want the full protocol detail (thresholds, matching policy, verdict math), read the [charter](charters/corpus-structural-decomposition-v1.md). If you want a plain-English explanation of what each dim produces, read [corpus-extraction-explained.md](corpus-extraction-explained.md).

## What you get at the end

- **Per-dim calibration verdict** (CELL PASS / MARGINAL / FAIL / NULL-GOLD) for each (book, dimension) cell at `novels/<key>/structure-calibration/<book>.json`.
- **Per-book conclusions document** at `novels/<key>/structure-calibration/<book>-conclusions.md` — human-readable interpretation: what the numbers mean, what to ship, what to fix, what to defer. This is the load-bearing artifact for downstream decisions.
- **Empirical distribution** of structural tags from a proven novel — e.g., polarity-shift distribution for value-charge, promise-count and open/close spans for promise.
- **Trustworthiness signal**: the verdict tells you whether the cheap V4 Flash extractor agrees with the stronger V4 Pro judge well enough to ship the distribution as a planner constraint.
- **Audit trail**: prompts, sampled rows, judge outputs, per-field disagreement breakdown — all on disk.

A CELL PASS on a dim means: the distribution from that dim is calibrated enough to add to the planner as a structural target. See "What to do with a CELL PASS" below.

> **Standing rule (2026-04-29)**: every analysis run produces a **conclusion + action**, not just numbers. The per-book `<book>-conclusions.md` file is **mandatory** alongside the verdict JSON. Each step in the walkthrough below has a **Conclusion** subsection — you fill it in as you run the step. If you're done with the steps but the conclusions doc is empty, you're not actually done.

> **Standing rule (2026-04-29) — no overwrites**: every output file is **immutable on disk**. Re-running an extractor or judge writes a NEW timestamped file; the prior file is preserved. The `<book>-conclusions.md` doc is **append-only** — new analysis sessions add a new dated section (`## Session YYYY-MM-DD HH:MM — <step or focus>`); existing sections are never edited. If a prior conclusion is invalidated, write a new section that references the old one rather than rewriting it. The audit trail of what we believed at each point matters as much as the current state.

### Output filename convention

All scripts in `scripts/corpus/` follow the same pattern:

```
<base>.<run_id>[.<variant>].<ext>
```

- `<run_id>` — UTC `YYYYMMDDTHHMMSS` stamped at write time by `nowStamp()` from `scripts/corpus/_run-stamp.ts`.
- `<variant>` — optional sub-tag (e.g. `pro`, `pro-t0`, `flash`, `sonnet`) when the file represents a specific model/temperature combination.

Examples:

```
promises.20260429T213820.json                 # Flash extractor default
promises.20260429T213820.pro.json             # V4 Pro extractor
promises.20260429T215322.sonnet.json          # Sonnet Tier 3 hand-extraction
value-charge.20260429T183957.jsonl            # value-charge per-scene tags
promise-gold.20260429T201219.jsonl            # V4 Pro judge gold
promise-gold.20260429T212435.flash.jsonl      # V4 Flash judge gold
crystal_shard.20260429T220528.json            # calibration verdict
crystal_shard.20260429T212822.flashxflash.json # 2×2 cell calibration verdict
```

There is **no `<base>.<ext>` canonical filename for new writes** — the absence of a fixed name is what makes overwrites structurally impossible. To find the latest output, glob the directory and pick the max-stamp file. The corpus scripts already do this via `findLatestStamped()` / `resolveLatestInput()`. Pre-2026-04-29 un-stamped files are preserved as a legacy fallback so existing tooling keeps reading until those files are migrated; new writes always go to stamped paths.

### Pinning to a specific run

`compute-calibration.ts` accepts:

- `--key-stamp=<YYYYMMDDTHHMMSS>` — pin the key file to that exact stamp (otherwise: latest matching variant)
- `--gold-stamp=<YYYYMMDDTHHMMSS>` — pin the gold file
- `--key-suffix=<variant>` / `--gold-suffix=<variant>` — variant tag (e.g. `pro`, `flash`)
- `--key-file=<full-path>` — bypass resolution entirely

`sample-for-adjudication.ts` accepts:

- `--source-stamp=<YYYYMMDDTHHMMSS>` — pin the source extractor file
- `--source-variant=<variant>` — variant tag

The calibration output JSON embeds the resolved `goldPath`, `goldRunId`, `keyPath`, `keyRunId` per cell under `sources.<dim>` so every verdict has a full provenance trail.

---

## Prerequisites — Stages 1-5

Stage 6 reads the output of the existing five-stage corpus pipeline. You must complete those stages first. See [`docs/corpus-pipeline.md`](corpus-pipeline.md) for the full walkthrough. The files Stage 6 needs:

```
novels/<key>/scenes.jsonl
novels/<key>/beats.jsonl
novels/<key>/pairs.jsonl
```

For the Salvatore Icewind Dale bundle these already exist. For a new corpus (Sanderson Mistborn, Robertson Breakers, etc.), complete Stages 1-5 from a PDF/EPUB first — see [`docs/corpus-ingestion.md`](corpus-ingestion.md) for the ingestion procedure.

Once Stages 1-5 are done, come back here.

---

## Add-a-new-corpus walkthrough

Replace `<novel>` with your bundle key (e.g. `sanderson-mistborn`) and `<book>` with the specific book slug (e.g. `final_empire`) throughout.

### Step 0 — check the manifest

```bash
cat novels/manifest.json
```

Confirm your novel bundle appears. If not, complete Stage 1 ingest first.

### Step 1 — preflight normalization

```bash
bun scripts/corpus/normalize-for-structure.ts \
  --novel <novel> --book <book>
```

This is non-LLM and fast (<1 second). It:
- Slices `scenes.jsonl`, `beats.jsonl`, `pairs.jsonl` to the single book.
- Assigns canonical chapter indices (prelude → -1, epilogue → 1000, etc.).
- Sorts beats into narrative order (the raw file is NOT in chapter order).
- Writes working files to `novels/<novel>/structure-tmp/<book>/`.

If it exits non-zero, read the error — it's a schema invariant (unmapped chapter label, bad `scene_id`, row count mismatch). Fix it before proceeding. Do not run extractors on unsorted source.

**Note for new corpora:** If your novel has non-standard chapter labels (e.g. `part1 / part2`, roman numerals, book-internal parts), you need to add a per-book label-to-index mapping inside `normalize-for-structure.ts` before the script will accept it. The Salvatore mapping (`crystal_shard` / `streams_of_silver` / `halflings_gem`) is the reference implementation.

### Step 2 — run the extractors

Run one command per dim. Each is independent; order does not matter.

**value-charge** (per scene, ~150 calls on a 30-chapter novel):
```bash
bun scripts/corpus/extract-structure.ts \
  --novel <novel> --book <book> --skip-promise
```

Output: `novels/<novel>/structure/<book>/value-charge.jsonl`

**promise** (per book, 2-pass, 2 calls total):
```bash
bun scripts/corpus/extract-structure.ts \
  --novel <novel> --book <book> --skip-value-charge
```

Output: `novels/<novel>/structure/<book>/promises.json`

**character-arcs** (per book, 1 call):
```bash
bun scripts/corpus/extract-character-arcs.ts \
  --novel <novel> --book <book>
```

Output: `novels/<novel>/structure/<book>/character-arcs.json`

**MICE** (per scene, same call volume as value-charge):
```bash
bun scripts/corpus/extract-mice.ts \
  --novel <novel> --book <book>
```

Output: `novels/<novel>/structure/<book>/mice.jsonl`

**McKee Gap** (per beat — ~6× more calls than value-charge, ~850 for crystal_shard):
```bash
bun scripts/corpus/extract-mckee-gap.ts \
  --novel <novel> --book <book>
```

Output: `novels/<novel>/structure/<book>/mckee-gap.jsonl`

All extractors use DeepSeek V4 Flash (non-thinking for most dims, thinking-on for promise). Total LLM cost for all five dims on one book is approximately **$0.85 at current V4 Pro promo pricing** (~$1.70 after the promo ends 2026-05-31). See §6a of [corpus-extraction-explained.md](corpus-extraction-explained.md) for the full cost breakdown by dim and call count from the `crystal_shard` reference run.

### Step 3 — sample for adjudication

One command per dim. This strips the LLM tags and writes source-only prompts for the judge.

```bash
bun scripts/corpus/sample-for-adjudication.ts \
  --novel <novel> --book <book> --dim value-charge --n 50

bun scripts/corpus/sample-for-adjudication.ts \
  --novel <novel> --book <book> --dim promise --n 50

bun scripts/corpus/sample-for-adjudication.ts \
  --novel <novel> --book <book> --dim mice --n 50

bun scripts/corpus/sample-for-adjudication.ts \
  --novel <novel> --book <book> --dim mckee-gap --n 50

bun scripts/corpus/sample-for-adjudication.ts \
  --novel <novel> --book <book> --dim character-arcs
```

Output per dim:
- `structure-gold/<book>/<dim>-prompts.jsonl` — source-only; what the judge sees
- `structure-gold/<book>/<dim>-key.jsonl` — hidden; maps sample IDs to LLM predictions

**n-floor caveat:** The retest self-disagreement gate needs at least 20 rows to be statistically meaningful. If a dim has fewer than 50 extractable rows (e.g., `promise` on a short novel may only have 14 promises), sample ALL of them and run each row at least twice through the judge for retest coverage. With n=5 retest pairs, the NULL-GOLD threshold (15% disagreement) is uninterpretable — the standard error is ~22 percentage points. See §6b of [corpus-extraction-explained.md](corpus-extraction-explained.md).

### Step 4 — run the LLM judge

The judge (DeepSeek V4 Pro, thinking-mode on) re-reads the source prompts and produces independent gold labels. It never sees the V4 Flash extractor output.

```bash
bun scripts/corpus/llm-judge.ts \
  --novel <novel> --book <book> --dim value-charge

bun scripts/corpus/llm-judge.ts \
  --novel <novel> --book <book> --dim promise

bun scripts/corpus/llm-judge.ts \
  --novel <novel> --book <book> --dim mice

bun scripts/corpus/llm-judge.ts \
  --novel <novel> --book <book> --dim mckee-gap

bun scripts/corpus/llm-judge.ts \
  --novel <novel> --book <book> --dim character-arcs
```

Output per dim:
- `structure-gold/<book>/<dim>-gold.jsonl` — judge labels (the "gold")
- `structure-gold/<book>/<dim>-judge-meta.json` — model, timestamp, run config

**V4 Pro thinking-mode can be slow.** Set a generous timeout:
```bash
LLM_REQUEST_TIMEOUT_MS=120000 bun scripts/corpus/llm-judge.ts \
  --novel <novel> --book <book> --dim promise
```

The promise judge in particular runs on 50K+ input tokens and takes 30-60 seconds per call. If a call times out, the judge script logs the failure and continues; check `judge-meta.json` for the timeout count before reading the verdict.

**Optional premium path:** For cross-family independence (stronger trust signal), run a Sonnet or Codex subagent on the lowest-confidence quartile (~10 rows) per the protocol in [`docs/structure-sonnet-judge-rubric.md`](structure-sonnet-judge-rubric.md). Save the output to `structure-gold/<book>/<dim>-sonnet.jsonl`. This is optional but recommended before shipping a PASS verdict to the planner.

### Step 5 — compute calibration verdict

```bash
bun scripts/corpus/compute-calibration.ts \
  --novel <novel> --book <book> --dim all
```

This joins extractor outputs against judge gold, computes P/R/F1, runs the per-field disagreement breakdown, and writes the verdict.

Output: `novels/<novel>/structure-calibration/<book>.json`

Per-dim flags if you want to run one at a time:
```bash
bun scripts/corpus/compute-calibration.ts \
  --novel <novel> --book <book> --dim value-charge --matcher=llm
```

**`--matcher` options:**
- `--matcher=llm` (default) — uses V4 Pro semantic matching to decide whether a predicted promise matches a gold promise. Handles paraphrase correctly. Required for the `promise` dim; recommended for all dims.
- `--matcher=tokens` — falls back to Jaccard/Levenshtein token similarity. Faster, free. Known to fail on semantically-equivalent paraphrased promises ("Errtu will pursue the crystal shard" vs "Errtu seeks Crenshinibon" share ~0.14 Jaccard — below the 0.5 floor). Use only as a diagnostic if the LLM matcher is unavailable.

### Step 6 — verify-pipeline audit

```bash
python3 scripts/corpus/verify-pipeline.py --novel <novel> --stage 6
```

This checks Stage 6 structural invariants: schema validity, evidence-quote substring presence, coverage (every scene/beat has a tag or explicit abstain reason), chapter-label domain completeness, sort stability. Output appended to `novels/<novel>/verification.json`.

Fix any hard-fail invariants before reading the calibration verdict.

---

## What each dim is

For the full schema and field-level explanation, see [`docs/corpus-extraction-explained.md`](corpus-extraction-explained.md) §2. Brief summary:

**value-charge** — per scene, does the polarity shift? Based on Coyne / McKee / Yorke / Truby / Swain (5-framework convergence). Tags: `valueIn`, `valueOut`, `lifeValue` (11-class enum), `polarity`, `confidence`, `evidence_quote`. Precision-first at calibration — false positives create wrong planner constraints.

**promise** — per book, what does the novel promise the reader, and does it pay off? Based on Sanderson / Lisle / LitRPG (3-framework convergence). Tags per promise: open/close chapter (label + canonical index), `payoff_quality`, evidence quotes. Recall-first at calibration — missed promises are dangling threads.

**character-arcs** — per main character per book, the canonical Lie/Truth/Want/Need (Weiland, 8-framework convergence — densest in the SYNTHESIS). Per-character tuple feeds the concept-phase character-agent.

**MICE** — per scene, which Sanderson MICE thread (Milieu/Idea/Character/Event) does this scene open or close? "Balanced parens" property: every opened thread must close. Genre fingerprint.

**McKee Gap** — per beat, the divergence between what the POV character expected and what actually happened. Maass / McKee / Coyne / Swain converge — gap on every beat is the tension-density signal. Per-novel gap_size distribution becomes a redraft-gate floor.

---

## Reading the verdict

Open `novels/<novel>/structure-calibration/<book>.json`. Each cell has `metrics` (P/R/F1, per-field rates) and `verdict`.

| Verdict | What it means |
|---|---|
| **CELL PASS** | Extractor agrees with judge at/above the cost-function-anchored floors. Distribution is trustworthy enough to ship as a planner constraint. |
| **CELL MARGINAL** | Lead metric is close but below floor; F1 ≥ 0.60. Consider one round of prompt iteration before promoting to PASS. |
| **CELL FAIL** | Extractor and judge disagree too much. Inspect per-field breakdown — often a matching-policy bug or prompt scope problem. See failure modes below. |
| **NULL-GOLD** | Judge's own outputs were internally inconsistent (cross-judge disagreement > 30% on sample, confirmed by manual review). Schema may be too subjective. Expand retest pool to ≥ 20 pairs before re-judging. |

**Lead metric per dim:** value-charge is precision-first (lead = P); promise is recall-first (lead = R). Different dims have different cost asymmetries — see §1 of the charter or §3 of [corpus-extraction-explained.md](corpus-extraction-explained.md).

**n-floor for NULL-GOLD:** NULL-GOLD triggered by a 15% judge self-disagreement threshold is only meaningful when the retest pool n ≥ 20. With n < 10, NULL-GOLD should be treated as "retest pool too small to call" rather than "schema too subjective."

---

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Judge times out, calls appear in `judge-meta.json` as failures | V4 Pro thinking-mode on long contexts hits default request timeout | Set `LLM_REQUEST_TIMEOUT_MS=120000` (or higher) and re-run `llm-judge.ts` with `--max-prompts=N` to pick up where it left off |
| F1 appears broken-low on promise (< 0.30) when pred and gold look similar | Token-similarity matcher (Jaccard/Levenshtein) rejecting paraphrased-but-same promises | Switch to `--matcher=llm`; V4 Pro understands semantic equivalence across paraphrase |
| NULL-GOLD verdict on small retest n (< 10) | Retest pool statistically too small to score the 15% disagreement threshold | Re-run `sample-for-adjudication.ts` with `--n 50` and add explicit retest rows; expand pool to ≥ 20 before re-judging |
| High judge-failure count in `judge-meta.json` | Judge agent role config issue — model not routing to V4 Pro | Check `src/models/roles.ts` entries for `structure-<dim>-judge`; confirm model is DeepSeek V4 Pro thinking-on |
| CELL FAIL with low recall, extractor under-extracts (e.g. promise R=0.30) | Expected on V4 Flash for semantically-complex dims (long-arc setup-payoff bridges); not a prompt bug | Three paths: (1) accept the lower-recall distribution for broad-arc promises only; (2) add a "did we miss any?" second pass with V4 Pro; (3) upgrade extractor to V4 Pro (~10× cost) if the planner constraint demands full recall |

---

## What to do with a CELL PASS verdict

1. **Derive the empirical distribution** from the tagged file. For value-charge: count the `polarity` distribution across all scenes (e.g. "+": 37%, "-": 41%, "0": 22%). For promise: distribution of open-to-close chapter span. For MICE: thread-type mix. For McKee Gap: gap_size distribution.

2. **Add it to planner context.** The distribution becomes a target constraint in the planning phase. Currently the right channel is the planner agent system prompt in `src/agents/planning-scenes/` or, for genre-level constraints, `src/models/roles.ts` `WRITER_GENRE_PACKS`. See the planning section of `CLAUDE.md` for the current planner architecture.

3. **Record the decision.** Add an entry to `docs/decisions.md`: which dim on which book CELL PASSed, the P/R/F1 numbers, and what planner constraint was derived. Commit the calibration file. Create a `tuning_experiment` DB record via `harness.experiments.createTuningExperiment()` linking the commit.

4. **Do not generalize across books yet.** A CELL PASS on `crystal_shard` (fantasy, 1988) is a calibration claim on that single book. Generalizing to a different stratum (Sanderson Mistborn, Robertson Breakers) requires running the same pipeline on those books. See [`docs/corpus-wide-analysis-todo.md`](corpus-wide-analysis-todo.md) for the roadmap.

---

## Step 7 (mandatory) — write the conclusions doc

After running the calibration + audit, you have a JSON verdict file. **You are NOT done yet.** Write the conclusion + action interpretation to `novels/<novel>/structure-calibration/<book>-conclusions.md`. The JSON file is the raw signal; the markdown is what people read to decide what to do.

**Format** — copy the template from an existing book (start with [`novels/salvatore-icewind-dale/structure-calibration/crystal_shard-conclusions.md`](../novels/salvatore-icewind-dale/structure-calibration/crystal_shard-conclusions.md)). It has:

1. **Summary verdict table** — one row per dim with the conclusion sentence (not just the verdict label)
2. **What this means for the planner** — broken into "ship now" (CELL PASS), "hold" (MARGINAL), "don't ship" (FAIL), "investigate" (NULL-GOLD)
3. **Per-step conclusions** — one section per analysis step you ran (extraction, calibration, matcher fix, judge re-runs, A/B comparisons). Each ends with a **Conclusion + Action** pair.
4. **Cost ledger** — calls + total spend per step
5. **Next decisions** — concrete things you or another operator should do based on what was learned

**Why this is mandatory:** raw P/R/F1 numbers aren't load-bearing for downstream decisions. Conclusions are. Without an explicit interpretation, you (or someone re-reading this in a month) has to re-derive what each verdict means in context. The conclusions doc is where the value of the calibration actually lands.

**Pattern note:** when you re-run a step (e.g. promise judge with a 15-min timeout, or fix a matcher policy and re-calibrate), append a new dated entry to the conclusions file rather than rewriting the old one. The history of what was tried is the audit trail.

---

## Linked context

| Resource | What it covers |
|---|---|
| [`docs/charters/corpus-structural-decomposition-v1.md`](charters/corpus-structural-decomposition-v1.md) | Full R7 charter — thresholds, matching policy, verdict math, budget |
| [`docs/corpus-extraction-explained.md`](corpus-extraction-explained.md) | Plain-English data dictionary, real crystal_shard results (§6a), n-floor problem (§6b) |
| [`docs/corpus-pipeline.md`](corpus-pipeline.md) | Stages 1-5 ingest (prerequisite) |
| [`docs/corpus-ingestion.md`](corpus-ingestion.md) | PDF/EPUB → canonical text procedure for new corpora |
| [`docs/structure-sonnet-judge-rubric.md`](structure-sonnet-judge-rubric.md) | Premium cross-family judge protocol (Sonnet / Codex subagent) |
| [`docs/corpus-wide-analysis-todo.md`](corpus-wide-analysis-todo.md) | Which corpora and dims to add next |
| `scripts/corpus/` | All Stage 6 scripts |
| `src/agents/structure-*/` | Per-dim extractor agent dirs (prompts, schemas, context builders) |
