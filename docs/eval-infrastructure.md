---
status: active
updated: 2026-04-16
---

# Eval Infrastructure

DB-backed surface for Phase C.3-style evals. Replaces the earlier practice of `/tmp/*.jsonl` files and ad-hoc phase-c3-vN.py scripts. Every eval is now persistent, queryable, joinable to `tuning_experiments`, and traceable back to the exact adapter + training data + git commit that produced it.

Migrations: `sql/024_eval_briefs_and_results.sql` + `sql/025_eval_provenance_view.sql`.

---

## Schema

### `eval_briefs`

Versioned brief sets. One row per `(set_name, beat_id)` pair.

| column | type | notes |
|---|---|---|
| `id` | SERIAL | |
| `set_name` | text | e.g. `salvatore-original-v1`, `salvatore-val-stratified-v1`, `salvatore-v3-actual-val` |
| `beat_id` | text | stable ID — e.g. `orig_tavern_ch1_s1_b0` or `crystal_shard_ch10_s1_b0` |
| `brief_json` | jsonb | full brief (characters, pov, setting, tone, kind, summary, words, etc.) |
| `ground_truth_prose` | text | real corpus prose when available (for val-mode evals that check memorization) |
| `ground_truth_style` | jsonb | precomputed style features on ground truth (optional) |
| `notes` | text | free-form — what this set is for, who built it, stratification rule |
| `created_at` | timestamptz | |
| unique | `(set_name, beat_id)` | upsert-safe |

**Versioning convention**: set_name ends with `-v1`, `-v2`, etc. when the brief set semantically changes. A formatter-stratification change is a version bump — **this is load-bearing.** See `docs/lessons-learned.md` "Eval-brief stratification must match training-data stratification" for the 2026-04-16 incident.

### `eval_results`

Per-beat results from every eval run. One row per `(experiment_id, set_name, beat_id, adapter_uri, cell_label)` combination.

| column | type | notes |
|---|---|---|
| `id` | SERIAL | |
| `experiment_id` | int → `tuning_experiments.id` | ties eval to the training run that produced the adapter |
| `set_name` | text | matches `eval_briefs.set_name` |
| `beat_id` | text | matches `eval_briefs.beat_id` |
| `adapter_uri` | text | full URI, e.g. `wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v3` |
| `cell_label` | text | `A-deepseek-bare` / `B-deepseek-primer` / `C-salvatore-lora-v3` etc. |
| `generated_prose` | text | what the adapter produced |
| `style_features` | jsonb | `{avg_sentence_words, dialogue_ratio, clause_complexity, sensory_density}` |
| `delta_sum` | numeric(8,4) | **per-row** delta from baseline (mean-of-deltas flavor; for cell-level use the view below) |
| `ngram_jaccard_vs_gt` | numeric(6,4) | memorization heuristic vs `ground_truth_prose` |
| `paragraph_breaks_count` | int | count of `\n\n` in `generated_prose` |
| `word_count` | int | |
| `bridge_repeat_detected` | bool | set by post-hoc analysis scripts |
| `lore_leak_tokens` | text[] | blocklisted tokens found in generated prose |
| `error_text` | text | populated when the call errored |
| `created_at` | timestamptz | |

### `eval_cell_summary` view

Phase-c3-compatible aggregate. `cell_delta_sum` is computed on cell-mean style features (**delta-of-means**), matching the print output of `phase-c3-generalization.py`. Use this for cell-level adapter comparisons; use raw `eval_results.delta_sum` for per-beat analysis.

```sql
SELECT adapter, set_name, n, cell_delta_sum, max_jaccard, avg_breaks
FROM (SELECT SUBSTRING(adapter_uri FROM '[^/]+$') AS adapter,
             set_name, n, cell_delta_sum, max_jaccard, avg_breaks
      FROM eval_cell_summary) s
ORDER BY set_name, cell_delta_sum;
```

### `eval_full_provenance` view

Joins `eval_results` × `eval_briefs` × `tuning_experiments`. Flattens the full lineage:
- adapter URI + derived W&B run URL + W&B artifact URL
- training config (base_model, train_file, epochs, LR, training_pairs, etc.)
- parent experiment IDs
- brief details + ground truth
- eval output metrics

Typical use: "how was this exact eval row produced?"

```sql
SELECT result_id, beat_id, adapter_uri, wandb_run_url, delta_sum,
       training_code_commit, train_file_path, epochs, parent_experiment_ids
FROM eval_full_provenance
WHERE set_name = 'salvatore-original-v1' AND beat_id = 'orig_tavern_ch1_s1_b0';
```

---

## Tooling

### Load briefs
```bash
bun scripts/finetune/load-eval-briefs.ts \
  --input /tmp/new-brief-set.jsonl \
  --set-name <set-name> \
  --notes "<what this set is and how it was built>"
```

Input JSONL accepts two shapes:
```json
{"brief": {"beat_id": "...", ...}}
{"brief": {...}, "ground_truth_prose": "...", "ground_truth_style": {...}}
```

Upserts by `(set_name, beat_id)` — safe to re-run.

### Dump briefs (for piping into phase-c3-*.py)
```bash
bun scripts/finetune/eval-db-read.ts --set-name salvatore-original-v1 > /tmp/briefs.jsonl
python3 scripts/finetune/phase-c3-vN.py --briefs /tmp/briefs.jsonl --mode original ...
```

### Write phase-c3 results back to DB
```bash
bun scripts/finetune/eval-db-write.ts \
  --input /tmp/phase-c3-vN-original.jsonl \
  --set-name salvatore-original-v1 \
  --experiment-id 196
```

Adapter URI is inferred from `cell_label` (`C-salvatore-lora-vN` → `wandb-artifact:///.../salvatore-1988-vN`); override with `--adapter-uri <uri>` for non-standard cell labels.

### Provenance report
```bash
bun scripts/finetune/provenance-report.ts --adapter salvatore-1988-v3
bun scripts/finetune/provenance-report.ts --experiment 196
bun scripts/finetune/provenance-report.ts --result-id 140
```

Prints the full lineage chain for any adapter/experiment/result — training config, W&B URLs, parent experiments, eval results, training-data file path.

---

## Standard workflow

New adapter evaluation end-to-end:

```bash
# 1. Train the adapter
EXPERIMENT_ID=N python3 scripts/finetune/train-lora.py --name <adapter>-vN ...

# 2. Ensure brief sets are loaded (once per stratification regime)
bun scripts/finetune/load-eval-briefs.ts --input briefs.jsonl --set-name <name>

# 3. Dump briefs, run phase-c3, ingest results
bun scripts/finetune/eval-db-read.ts --set-name <name> > /tmp/briefs.jsonl
python3 scripts/finetune/phase-c3-vN.py --briefs /tmp/briefs.jsonl --mode <mode> ...
bun scripts/finetune/eval-db-write.ts --input /tmp/phase-c3-vN-mode.jsonl --set-name <name> --experiment-id N

# 4. Compare against other adapters
psql -c "SELECT * FROM eval_cell_summary ORDER BY set_name, cell_delta_sum"

# 5. Inspect lineage of any specific result
bun scripts/finetune/provenance-report.ts --result-id <id>
```

---

## Versioning conventions

### Brief sets (`set_name`)

- `-v1` suffix on first loaded version
- Version bump when:
  - Brief contents materially change (additions/removals/edits)
  - Stratification rule changes (e.g. from book-kind to chapter-based)
  - Ground-truth prose or style recomputed
- Don't version-bump for notes-only updates — use in-place upsert

**Current brief sets (2026-04-16):**
- `salvatore-original-v1` — 18 original-character cross-distribution briefs (no Salvatore lore). Expanded from 6 on 2026-04-16.
- `salvatore-val-stratified-v1` — 74 beats from v2 formatter, stratified by (book, kind), seed=42. **Do not use for evaluating v3+ — stratification mismatch**, see lessons-learned incident.
- `salvatore-v3-actual-val` — 60 beats from v3 formatter's chapter-stratified val split. Valid for v3 only.

### Adapters (URIs)

- Always include the version in the URI: `salvatore-1988-v3`, not `:latest`
- Point genre packs at specific versions in `src/models/roles.ts`; don't rely on `:latest` aliasing
- Never reuse a version number (v3 replaces v2 by genre-pack re-pointing, not by overwriting v2's artifact)

---

## Pointers

- Migrations: `sql/024_eval_briefs_and_results.sql`, `sql/025_eval_provenance_view.sql`
- Tooling: `scripts/finetune/{load-eval-briefs,eval-db-read,eval-db-write,provenance-report}.ts`
- Lessons: `docs/lessons-learned.md` — "Eval-brief stratification…", "Cell-level Δ-sum…", "Paragraph breaks can silently vanish…"
- Decisions: `docs/decisions.md` — "Pre-2026-04-15 telemetry and state archived" + "All 70 existing novels archived"
- Voice LoRA post-mortem: `docs/voice-lora-salvatore.md` §8 (v2 probe failure), §9 (v3 + eval infra)
