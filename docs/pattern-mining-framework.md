---
status: active
updated: 2026-04-30
---

# Pattern Mining Framework

Codification of the corpus-pattern mining methodology that emerged organically across 30+ pattern-mining sessions on the Salvatore Icewind Dale 3-book corpus (`novels/salvatore-icewind-dale/structure-calibration/`). The shared library lives at `scripts/structure-calibration/lib/`; the machine-readable verdict registry lives at `novels/<corpus>/structure-calibration/pattern-registry.json`.

## Overview

Each "pattern" is a structural property of an author's published prose: chapter length, beat-kind ordering, sensory-mode density, opener taxonomy, etc. The framework mines patterns from a decomposed corpus (`beats.jsonl` / `scenes.jsonl`), computes a per-book reproduction verdict, and emits three artifacts:

1. **Timestamped JSON** in `novels/<corpus>/structure-calibration/` with raw stats + verdict.
2. **Markdown section** appended to the corpus's `crystal_shard-conclusions.md` (parallel-safe under fcntl flock).
3. **Roadmap row** inserted before the `**Sequencing**` anchor in `docs/harness-tuning-roadmap.md`.

The framework exists to:

- **Reduce per-pattern boilerplate.** Earlier scripts re-implemented gate logic, atomic appends, and timestamped filenames each time. Now they import from `lib/`.
- **Make verdicts machine-readable.** Markdown roadmap rows are human-readable but not greppable as data. `pattern-registry.json` is the cross-pattern view a sequencer / variant-builder reads.
- **Encode the methodology.** Per-book gating, anchor-stability discipline, no-overwrite semantics — all enforced by the library so future patterns can't accidentally regress to aggregate-only verdicts.

## Methodology — the directional gate

Every pattern emits a verdict in `{PASS, PASS_PARTIAL, DIVERGE, KILL}` (with a few decorated variants like `PASS_MODAL_ONLY`). The verdict is purely **directional**: it asks "does the pattern reproduce qualitatively across books?" — not "what is the precise magnitude?" Per the user's standing rule:

> ≥ 90% confident a pattern reproduces qualitatively is sufficient to ship as a planner prior. Tight quantitative CIs are NOT required.

(Pulled from `docs/harness-tuning-roadmap.md` "Ship gate framing" — re-read before defining new gates.)

### Five gate shapes

`scripts/structure-calibration/lib/directional_gate.py` exports five gate functions corresponding to the verdict shapes that actually recur in pattern mining:

| Gate | Used when |
|---|---|
| `gate_modal_class(per_book_modal_classes)` | The pattern's claim is "the most-frequent class is the same across books" (e.g., P3a opener kind). |
| `gate_ranking_jaccard(per_book_rankings, top_n=3)` | The pattern's claim is "the top-N set is roughly the same across books" with set semantics (e.g., P26 chapter-title shapes). |
| `gate_sign_of_effect(per_book_signs)` | The pattern's claim is "the trend goes in the same direction in all books" (e.g., P4-action density rising q0→q4). |
| `gate_density_spread(per_book_densities, threshold_pct)` | The pattern's claim is "the per-book magnitude is in a tight band" (e.g., P1 chapter-length spread <20%). |
| `gate_top_k_overlap(per_book_topk_sets, top_n=3, min_shared_pairs=3)` | The pattern's claim is "the top-N set has substantial intersection across books" (e.g., P7 beat boundary signals top-4 set). |

`combine_gates([...])` returns the LEAST-favorable verdict across multiple gate results (PASS only if all PASS; KILL if any KILL; DIVERGE if any DIVERGE; otherwise PASS_PARTIAL). Use it when a single pattern emits multiple gates.

### Why per-book gating is mandatory

Aggregate metrics smooth over per-book divergence. Per `docs/lessons-learned.md` 2026-04-30 "Aggregate-only patterns can survive while per-book patterns fail" (Pattern 32 anti-finding):

> Pattern 32 (chapter-seam transition shape) join produced a strongest aggregate independence-outlier of `foreshadow → time-cut-announcement` at 3.6× over marginal. Per-book breakdown: 3 in crystal_shard, 0 in streams_of_silver, 0 in halflings_gem. The aggregate signal is *entirely book-1-driven* — a planner rule built from the aggregate would encode a pattern that two of three books actively don't reproduce.

The library only exposes per-book inputs. There is no `gate_aggregate(...)` function — that would re-introduce the bug.

## Repeatability vs precision — the ship-gate framing

The directional gate is a binary "does it reproduce qualitatively" test. Precision lives at a different layer (CIs, magnitude), and is **explicitly not load-bearing for ship decisions**. From `docs/harness-tuning-roadmap.md`:

| Books | 95% CI on a binary proportion @ p≈0.5 |
|---|---|
| 1 (n≈34 chapters) | ±17% (range 33–67% on a 50% point estimate) |
| 2 | ±12% |
| 3 | ±10% |
| 11+ | ±5% |

Cross-book validation answers reproduction, not precision. Three books is enough to discriminate "Salvatore quirk" vs "author/genre pattern"; getting tighter ±5% CIs requires 11+ books and is diminishing-returns. The current planner-prompt rules are already consistent with the wide n=34 CI; **don't gate variant ship decisions on CI tightness**.

This is the reason the framework's ship recommendations are coarse — `ship`, `ship_partial`, `hold`, `kill`. Sub-gates can carry numeric details (Jaccard scores, modal-set sizes), but those are evidence, not a ship-blocking floor.

## SOP — adding a new pattern

1. **Add a row to `docs/harness-tuning-roadmap.md`** with verdict `pending`. Use the table format with 8 columns (`# | Pattern | Harness target | Variant drafted? | Probe run? | Cross-book? | Point-estimate verdict | Directional verdict`). Land it as a separate `[docs]` commit if it precedes the script.

2. **Copy the template** to `scripts/structure-calibration/<your-pattern-slug>.py`:

   ```bash
   cp scripts/structure-calibration/lib/pattern_template.py \
      scripts/structure-calibration/your-pattern-slug.py
   ```

3. **Fill in the marked extension points**:
   - `PATTERN_NUMBER` — the row number in the roadmap.
   - `PATTERN_NAME` — short human-readable name.
   - `PATTERN_SLUG` — the JSON filename slug (e.g., `"sensory-mode-density"`).
   - The body of `analyze()` — your pattern logic.
   - Optionally override `render_conclusions_md()` and `render_roadmap_row()` if your pattern needs a custom summary shape.

4. **Run the script**:

   ```bash
   python3 scripts/structure-calibration/your-pattern-slug.py
   ```

   The template handles JSON write, conclusions append, and roadmap insert. All three are atomic under fcntl flock.

5. **Verify the outputs**:
   - Check `novels/<corpus>/structure-calibration/<prefix>.<TS>.<slug>.json` exists with the expected schema.
   - `git diff novels/<corpus>/structure-calibration/crystal_shard-conclusions.md` should show your new section appended.
   - `git diff docs/harness-tuning-roadmap.md` should show your row inserted before `**Sequencing`.

6. **Update the registry**:
   - Re-run the registry generator (or manually edit `novels/<corpus>/structure-calibration/pattern-registry.json`).
   - Verify your verdict, gate types, ship recommendation, and data-artifact path resolved correctly.

7. **Commit**:
   - One commit per pattern (or one batch commit if the patterns are co-load-bearing).
   - Per CLAUDE.md Rule 13 (pre-authorized commits) — no need to ask, just commit.

### Code skeleton (cherry-picked from `pattern_template.py`)

```python
from directional_gate import (
    gate_density_spread, gate_modal_class, gate_ranking_jaccard,
    gate_sign_of_effect, gate_top_k_overlap, combine_gates,
)
from atomic_io import (
    atomic_append_section, atomic_insert_row_before_anchor,
    write_timestamped_json,
)

def analyze(beats):
    # 1. per-book bucketing
    by_book = defaultdict(list)
    for b in beats:
        by_book[b["book"]].append(b)

    # 2. per-book metric
    per_book_density = {
        book: compute_density(beats_for_book)
        for book, beats_for_book in by_book.items()
    }

    # 3. gate
    verdict = gate_density_spread(per_book_density, threshold_pct=20.0)

    return {
        "per_book_density": per_book_density,
        "verdict": verdict,
        "gates_used": ["density_spread"],
        "findings_short": f"per-book density spread → {verdict}",
    }
```

## Atomicity rules

Three rules, all enforced by `lib/atomic_io.py`:

1. **`fcntl.flock` for parallel-safe appends.** When N subagents write to the same `crystal_shard-conclusions.md` near-simultaneously, raw appends race. Per `docs/lessons-learned.md` 2026-04-30 "Parallel subagents writing to the same append-only doc need atomic write-then-rename":
   > Patterns 28 / 32 / 33 / 37 all ran in parallel on 2026-04-30 and all appended to the same `crystal_shard-conclusions.md`. Three race conditions surfaced: (1) merge-conflict markers, (2) concurrent stash, (3) commits accidentally deleting prior addenda.

   `atomic_append_section()` and `atomic_insert_row_before_anchor()` both take an exclusive flock before write and release on exit. Advisory lock — only works if all writers go through the API.

2. **Timestamped output filenames; never overwrite.** Every JSON artifact lands at `<prefix>.<YYYYMMDDTHHMMSS>.<slug>.json`. Re-running an analysis writes a NEW file, never overwriting. Per memory feedback `feedback_no_overwrite_runs` and `docs/lessons-learned.md` 2026-04-30 "Preserve every analysis run; never overwrite":
   > Every analysis script writes timestamped output. Conclusions docs are append-only. This pattern paid off concretely: the mckee-gap binary collapse re-aggregation referenced the n=50 wave's raw labels still on disk; the lifeValueAxes 5-class → 5-binary collapse referenced the same wave for all 5 axes. None of those analyses required new labeling because the source data was preserved.

   `write_timestamped_json()` falls back to millisecond precision if two calls collide within the same UTC second.

3. **Conclusions docs are append-only.** New sessions append; never edit prior sections. The atomic_append helper does not have an "edit" mode by design — if you find yourself wanting to overwrite a prior section, write a new section instead.

## Anchor stability for LLM classification

For patterns whose computation requires an LLM call (e.g., `chapter-opener-taxonomy.py`, `pov-distribution.py`), the directional gate is necessary but not sufficient. The library does not currently encode anchor-stability gating; pattern authors must run a separate Sonnet self-consistency check before treating a verdict as final.

Per `docs/lessons-learned.md` 2026-04-30 "Cross-model F1 ≠ anchor stability":

> A dim ships only when BOTH pass. Cross-model F1 catches "extractor disagrees with the oracle"; anchor stability catches "the oracle disagrees with itself."

And 2026-04-30 "Granularity rotation":

> Run a confirmation wave at the OTHER granularity. Ship the field only if Jaccard ≥ 0.85 at BOTH granularities (the intersection).

Operationally, for stochastic-schema dims:

1. **Run two same-config Sonnet passes** at the granularity at which the schema EMITS (beat-level if the schema field is on `sceneBeatSchema`, scene-level otherwise).
2. **Compute Jaccard between the two passes.** Ship only if J ≥ 0.85 at BOTH calibration-anchor AND production-emit granularities.
3. **For low-prevalence dims** (positive rate < 30%), n=50 is screening only; run the full population before declaring a ship verdict. Per the same doc: "the n=50 anchor self-consistency check is a SCREENING TOOL ... the actual ship gate must run on the full population."
4. **For multi-axis / compositional dims** (e.g., chapter-title primary+secondary shape), hand-spot 5–10 candidate cases or run a Sonnet anchor pass on the full sample before publishing a low-prevalence DIVERGE/KILL — DeepSeek V4 Flash had a 75% false-negative rate on Pattern 26's secondary-shape axis.

The framework's `pattern-registry.json` records the gate types used per pattern (`gate_types_used: ["modal_class", "top_k_overlap"]`); when a pattern's gates rely on LLM classification, the anchor-stability evidence should live in the JSON artifact alongside the gate stats.

## Common pitfalls

### Schema-prompt drift (Pattern 0c8457d)

The planner prompt advertised an enum (`miceActive: ('I'|'C'|'E')[]`) that the schema only accepted as `['I']`. Symptom: planner output silently rejected at validation. Fix: the prompt was updated to match the schema. Generalized rule (memory `feedback_schema_of_record_check`): before landing code that assumes array size / enum / structural shape, grep the production schema-of-record and confirm.

When mining patterns that propose new schema fields (e.g., `openerKind` enum from P49), the pattern script's role is *measurement*; the schema edit is a separate downstream step. Do not assume the schema is what the pattern script wishes it were.

### Aggregate-vs-per-book signal collapse (Pattern 32)

Already covered above. The library's per-book inputs prevent this at the gate boundary, but pattern authors must still avoid pre-aggregating their data before reaching the gate. If `per_book_modal_classes` is built from a pooled-then-split function, the pooling re-introduces the bias.

### Low-prevalence LLM under-flagging (Pattern 26 via DeepSeek V4 Flash)

DeepSeek V4 Flash returned 2/79 (2.5%) compositional pairs across the 3-book corpus; Sonnet's anchor re-pass found 8/79 (10.1%) — a 75% false-negative rate. The mechanism is multi-axis recognition cost: a non-thinking instruction-tuned model handles single-class picks well but defaults to single-tag when uncertain on compositional ones.

Operational rule (per `docs/lessons-learned.md` 2026-04-30 "Hand-spot LLM probe verdicts on low-prevalence multi-axis dimensions"): for low-prior multi-axis classifications, accept a cheap labeler for primary axis but plan a Sonnet anchor pass on the secondary axis as a follow-up. Never publish a "low-prevalence KILL" verdict on a multi-axis dim without anchor confirmation.

### Parallel-append race conditions (Patterns 28/32/33/37)

The naive "git pull → edit → git add → git commit" pattern does not survive 4+ parallel agents writing to the same shared append-only document. The fix is two-layer:

1. **In-process**: every append goes through `atomic_append_section()` (fcntl flock).
2. **Cross-process**: the library doesn't solve the cross-process git layer, but the recommended pattern (per `docs/lessons-learned.md` 2026-04-30) is per-subagent stub files (`conclusions-stubs/<pattern>.md`) merged by a single orchestrator commit. The framework supports this — `atomic_append_section()` works fine if subagents target distinct files.

## Reference files

| File | Purpose |
|---|---|
| `scripts/structure-calibration/lib/directional_gate.py` | Five gate functions + `combine_gates()`. Pure functions; no I/O. |
| `scripts/structure-calibration/lib/atomic_io.py` | Three I/O helpers: append, insert-before-anchor, timestamped-write. |
| `scripts/structure-calibration/lib/pattern_template.py` | Reference template for new pattern scripts. Runnable as-is (no-op). |
| `novels/<corpus>/structure-calibration/pattern-registry.json` | Machine-readable verdict registry (mirror of the roadmap rows). |
| `docs/harness-tuning-roadmap.md` | Human-facing roadmap; the source of truth for verdict text. |
| `docs/lessons-learned.md` | Methodology lessons; cited from gate docstrings. |
| `docs/pattern-hypothesis-bank.md` | Forward queue of patterns to mine. |
