# Salvatore V5 Corpus Expansion Runbook

Operator guide for Option A in `docs/todo.md`: expand the Salvatore corpus with additional book bundles, merge them with `novels/salvatore-icewind-dale/`, and stop at a hashed training-pairs artifact for human approval.

Current scope:

- Do create new bundles under `novels/`
- Do reuse the Icewind Dale reference layout and reports
- Do stop before W&B submission
- Do not edit `novels/salvatore-icewind-dale/`

## 1. Book plan

Minimum viable Option A = the top 3 available titles. Preferred core plan = top 4. Fifth is optional stretch capacity.

| Priority | Bundle key | Title | Voice gap it fills |
|---------|------------|-------|--------------------|
| 1 | `salvatore-homeland` | `Homeland` | Zaknafein, House Do'Urden menace, younger Drizzt under drow pressure |
| 2 | `salvatore-the-legacy` | `The Legacy` | adult Catti-brie warmth, stressed Wulfgar, Entreri coldness |
| 3 | `salvatore-starless-night` | `Starless Night` | Jarlaxle theatrical charm, drow political banter, Entreri contrast |
| 4 | `salvatore-servant-of-the-shard` | `Servant of the Shard` | Jarlaxle / Entreri-heavy dialogue density |
| 5 | `salvatore-sojourn` | `Sojourn` | surface-world outsider / mentor register; optional stretch |

Do not substitute `pinquickles-folly.txt` for missing priority books. It is late-style drift material, not v5 training material.

## 2. Preflight

### Step 0: source-file gate

If the required source books are not already on disk, stop here.

**Do not download, scrape, or fabricate PDFs.**

Expected source locations:

```text
novels/salvatore-homeland/source/original.pdf
novels/salvatore-the-legacy/source/original.pdf
novels/salvatore-starless-night/source/original.pdf
novels/salvatore-servant-of-the-shard/source/original.pdf
novels/salvatore-sojourn/source/original.pdf
```

Create the `source/` directories first if they do not exist yet:

```bash
mkdir -p \
  novels/salvatore-homeland/source \
  novels/salvatore-the-legacy/source \
  novels/salvatore-starless-night/source \
  novels/salvatore-servant-of-the-shard/source \
  novels/salvatore-sojourn/source
```

Sanity-check file presence, size, and page count before ingest:

```bash
python3 - <<'PY'
from pathlib import Path
from pypdf import PdfReader

paths = [
    Path("novels/salvatore-homeland/source/original.pdf"),
    Path("novels/salvatore-the-legacy/source/original.pdf"),
    Path("novels/salvatore-starless-night/source/original.pdf"),
    Path("novels/salvatore-servant-of-the-shard/source/original.pdf"),
    Path("novels/salvatore-sojourn/source/original.pdf"),
]

for path in paths:
    print(f"\n{path}")
    if not path.exists():
        print("  MISSING")
        continue
    size_mb = path.stat().st_size / (1024 * 1024)
    try:
        pages = len(PdfReader(str(path)).pages)
    except Exception as exc:
        pages = f"ERROR: {exc}"
    print(f"  size_mb={size_mb:.2f}")
    print(f"  pages={pages}")
PY
```

Sanity thresholds:

- file exists
- roughly `0.5 MB+`
- roughly `200+` pages for a full novel PDF
- anything tiny, image-only, or single-digit pages is the wrong asset

### Current tooling caveat

`docs/corpus-pipeline.md` describes Stage 1 output as `canonical.txt`, but the current runnable bundle scripts still consume `config.yml` `source_files` under `source/*.txt`, exactly like `novels/salvatore-icewind-dale/`. Follow the **actual script surface** below until the tooling is unified.

### Environment / tooling check

Required now:

- `python3`
- `bun`
- `pypdf`
- authenticated Claude Code session for the manual subagent batches

Not required in this runbook:

- `WANDB_API_KEY`
- `train-lora.py`

## 3. Bundle bootstrap

Run this once per available title. After the `cp`, edit `config.yml` manually.

### `salvatore-homeland`

```bash
mkdir -p novels/salvatore-homeland/{source,analysis,reports,review}
cp novels/salvatore-icewind-dale/config.yml novels/salvatore-homeland/config.yml
```

### `salvatore-the-legacy`

```bash
mkdir -p novels/salvatore-the-legacy/{source,analysis,reports,review}
cp novels/salvatore-icewind-dale/config.yml novels/salvatore-the-legacy/config.yml
```

### `salvatore-starless-night`

```bash
mkdir -p novels/salvatore-starless-night/{source,analysis,reports,review}
cp novels/salvatore-icewind-dale/config.yml novels/salvatore-starless-night/config.yml
```

### `salvatore-servant-of-the-shard`

```bash
mkdir -p novels/salvatore-servant-of-the-shard/{source,analysis,reports,review}
cp novels/salvatore-icewind-dale/config.yml novels/salvatore-servant-of-the-shard/config.yml
```

### `salvatore-sojourn`

```bash
mkdir -p novels/salvatore-sojourn/{source,analysis,reports,review}
cp novels/salvatore-icewind-dale/config.yml novels/salvatore-sojourn/config.yml
```

Manual `config.yml` edits required before Stage 2:

- set `key`, `title`, `year`, `books`
- set `source_files` to the ingested `.txt` file for that bundle
- trim `characters` down to the dominant POV / dialogue cast for that title
- keep `training_roles`, `analyzers`, and `review_gates` aligned with the Icewind template unless there is a concrete reason to differ

## 4. Per-book Stage 1 → 4 commands

Expected per-book runtime and direct spend, assuming a 90K-110K-word novel:

| Stage | Runtime | Direct spend | Notes |
|-------|---------|--------------|-------|
| Stage 1 ingest | 2-10 min | $0 | PDF-dependent |
| Stage 2 scenes | <1 min | $0 | deterministic |
| Stage 3 beats prepare/merge | <2 min local | $0 | local prep/merge only |
| Stage 3 beat subagents | ~25-30 batches | $0 direct | current batch size `5` scenes |
| Stage 4 briefs prepare/merge | <2 min local | $0 | local prep/merge only |
| Stage 4 brief subagents | ~80-90 batches | $0 direct | current batch size `10` beats |
| Verify | <1 min | $0 | local audit |

Reference scaling from Icewind Dale:

- 352 scenes produced 71 beat batches at `--batch-size 5`
- 2,470 beats produced 124 brief batches at `--batch-size 10`

### `salvatore-homeland`

```bash
python3 scripts/finetune/ingest-corpus.py \
  --input novels/salvatore-homeland/source/original.pdf \
  --output novels/salvatore-homeland/source/homeland.txt \
  --json

bun scripts/corpus/run.ts --novel salvatore-homeland --stage scenes

bun scripts/corpus/run.ts --novel salvatore-homeland --stage beats-prepare \
  --prompt-dir /tmp/beat-prompts-salvatore-homeland \
  --batch-size 5

bun scripts/corpus/run.ts --novel salvatore-homeland --stage beats-merge \
  --results-dir /tmp/beat-results-salvatore-homeland

bun scripts/corpus/run.ts --novel salvatore-homeland --stage briefs-prepare \
  --prompt-dir /tmp/brief-prompts-salvatore-homeland \
  --batch-size 10

bun scripts/corpus/run.ts --novel salvatore-homeland --stage briefs-merge \
  --results-dir /tmp/brief-results-salvatore-homeland

bun scripts/corpus/run.ts --novel salvatore-homeland --stage verify
```

### `salvatore-the-legacy`

```bash
python3 scripts/finetune/ingest-corpus.py \
  --input novels/salvatore-the-legacy/source/original.pdf \
  --output novels/salvatore-the-legacy/source/the-legacy.txt \
  --json

bun scripts/corpus/run.ts --novel salvatore-the-legacy --stage scenes

bun scripts/corpus/run.ts --novel salvatore-the-legacy --stage beats-prepare \
  --prompt-dir /tmp/beat-prompts-salvatore-the-legacy \
  --batch-size 5

bun scripts/corpus/run.ts --novel salvatore-the-legacy --stage beats-merge \
  --results-dir /tmp/beat-results-salvatore-the-legacy

bun scripts/corpus/run.ts --novel salvatore-the-legacy --stage briefs-prepare \
  --prompt-dir /tmp/brief-prompts-salvatore-the-legacy \
  --batch-size 10

bun scripts/corpus/run.ts --novel salvatore-the-legacy --stage briefs-merge \
  --results-dir /tmp/brief-results-salvatore-the-legacy

bun scripts/corpus/run.ts --novel salvatore-the-legacy --stage verify
```

### `salvatore-starless-night`

```bash
python3 scripts/finetune/ingest-corpus.py \
  --input novels/salvatore-starless-night/source/original.pdf \
  --output novels/salvatore-starless-night/source/starless-night.txt \
  --json

bun scripts/corpus/run.ts --novel salvatore-starless-night --stage scenes

bun scripts/corpus/run.ts --novel salvatore-starless-night --stage beats-prepare \
  --prompt-dir /tmp/beat-prompts-salvatore-starless-night \
  --batch-size 5

bun scripts/corpus/run.ts --novel salvatore-starless-night --stage beats-merge \
  --results-dir /tmp/beat-results-salvatore-starless-night

bun scripts/corpus/run.ts --novel salvatore-starless-night --stage briefs-prepare \
  --prompt-dir /tmp/brief-prompts-salvatore-starless-night \
  --batch-size 10

bun scripts/corpus/run.ts --novel salvatore-starless-night --stage briefs-merge \
  --results-dir /tmp/brief-results-salvatore-starless-night

bun scripts/corpus/run.ts --novel salvatore-starless-night --stage verify
```

### `salvatore-servant-of-the-shard`

```bash
python3 scripts/finetune/ingest-corpus.py \
  --input novels/salvatore-servant-of-the-shard/source/original.pdf \
  --output novels/salvatore-servant-of-the-shard/source/servant-of-the-shard.txt \
  --json

bun scripts/corpus/run.ts --novel salvatore-servant-of-the-shard --stage scenes

bun scripts/corpus/run.ts --novel salvatore-servant-of-the-shard --stage beats-prepare \
  --prompt-dir /tmp/beat-prompts-salvatore-servant-of-the-shard \
  --batch-size 5

bun scripts/corpus/run.ts --novel salvatore-servant-of-the-shard --stage beats-merge \
  --results-dir /tmp/beat-results-salvatore-servant-of-the-shard

bun scripts/corpus/run.ts --novel salvatore-servant-of-the-shard --stage briefs-prepare \
  --prompt-dir /tmp/brief-prompts-salvatore-servant-of-the-shard \
  --batch-size 10

bun scripts/corpus/run.ts --novel salvatore-servant-of-the-shard --stage briefs-merge \
  --results-dir /tmp/brief-results-salvatore-servant-of-the-shard

bun scripts/corpus/run.ts --novel salvatore-servant-of-the-shard --stage verify
```

### `salvatore-sojourn`

```bash
python3 scripts/finetune/ingest-corpus.py \
  --input novels/salvatore-sojourn/source/original.pdf \
  --output novels/salvatore-sojourn/source/sojourn.txt \
  --json

bun scripts/corpus/run.ts --novel salvatore-sojourn --stage scenes

bun scripts/corpus/run.ts --novel salvatore-sojourn --stage beats-prepare \
  --prompt-dir /tmp/beat-prompts-salvatore-sojourn \
  --batch-size 5

bun scripts/corpus/run.ts --novel salvatore-sojourn --stage beats-merge \
  --results-dir /tmp/beat-results-salvatore-sojourn

bun scripts/corpus/run.ts --novel salvatore-sojourn --stage briefs-prepare \
  --prompt-dir /tmp/brief-prompts-salvatore-sojourn \
  --batch-size 10

bun scripts/corpus/run.ts --novel salvatore-sojourn --stage briefs-merge \
  --results-dir /tmp/brief-results-salvatore-sojourn

bun scripts/corpus/run.ts --novel salvatore-sojourn --stage verify
```

Subagent handoff conventions:

- beat results go to `/tmp/beat-results-<bundle-key>/scene_id.json`
- brief results go to `/tmp/brief-results-<bundle-key>/batch_NNN.json`
- rerun only failed scenes / batches, never the whole corpus by default

## 5. Checkpoint validation

Do not advance a bundle if the prior stage fails its conservation gate.

### After Stage 1 ingest

Inspect:

- `novels/<bundle>/source/*.report.json`

Checks:

- `I1.1` ingested text exists and is non-empty
- `I1.2` word count is `>= 50K`
- `I1.3` at least `5` chapter markers detected
- scene breaks are not zero unless a known image-ornament / EPUB quirk explains it

### After Stage 2 scenes

Inspect:

- `novels/<bundle>/scenes.report.json`

Checks:

- `I2.1` `missing_chapters: []`
- `I2.2` total scene words retain at least `90%` of Stage 1 words
- `I2.3` no empty scenes

### After Stage 3 beats

Inspect:

- `novels/<bundle>/beats.merge-report.json`

Checks:

- `I3.1` `scenes_missing_results == []`
- `I3.1` `scenes_with_zero_beats == []`
- `I3.3` no malformed beat objects
- `I3.4` out-of-band 30-300w beats are review items, not auto-fails
- `I3.5` median beat size lands near `80-140w`

If Stage 3 fails:

- rerun only the missing / malformed scenes
- do not continue to briefs

### After Stage 4 briefs

Inspect:

- `novels/<bundle>/pairs.merge-report.json`
- `novels/<bundle>/verification.json`

Checks:

- `I4.1` `beats_without_brief == []`
- `I4.1` `orphan_briefs == []`
- `I4.2` `malformed_briefs == []`
- spot-check that `brief.pov` and `brief.characters` align with the bundle's character registry

Bundle is usable only after `bun scripts/corpus/run.ts --novel <bundle> --stage verify` reports clean or only soft warnings.

## 6. Merge with Icewind Dale

Never fold new rows into `novels/salvatore-icewind-dale/`. Build a fresh merged corpus artifact.

Target artifact path:

```text
novels/salvatore-v5-corpus/pairs.jsonl
novels/salvatore-v5-corpus/reports/merge-report.json
```

Merge command:

```bash
python3 - <<'PY'
import hashlib
import json
from pathlib import Path

inputs = [
    Path("novels/salvatore-icewind-dale/pairs.jsonl"),
    Path("novels/salvatore-homeland/pairs.jsonl"),
    Path("novels/salvatore-the-legacy/pairs.jsonl"),
    Path("novels/salvatore-starless-night/pairs.jsonl"),
    Path("novels/salvatore-servant-of-the-shard/pairs.jsonl"),
    # Optional fifth:
    # Path("novels/salvatore-sojourn/pairs.jsonl"),
]

out = Path("novels/salvatore-v5-corpus/pairs.jsonl")
report = Path("novels/salvatore-v5-corpus/reports/merge-report.json")
out.parent.mkdir(parents=True, exist_ok=True)
report.parent.mkdir(parents=True, exist_ok=True)

seen_beat_ids = set()
seen_fingerprints = set()
rows_written = 0
duplicate_beat_ids = []
duplicate_fingerprints = []

with out.open("w") as wf:
    for path in inputs:
        if not path.exists():
            raise SystemExit(f"missing input: {path}")
        for line in path.open():
            row = json.loads(line)
            beat_id = row["brief"]["beat_id"]
            prose_norm = " ".join(row["prose"].split())
            fp = hashlib.sha256(
                (
                    row["brief"].get("pov", "")
                    + "||"
                    + row["brief"].get("summary", "")
                    + "||"
                    + prose_norm
                ).encode("utf-8")
            ).hexdigest()

            if beat_id in seen_beat_ids:
                duplicate_beat_ids.append({"beat_id": beat_id, "source": str(path)})
                continue
            if fp in seen_fingerprints:
                duplicate_fingerprints.append({"beat_id": beat_id, "source": str(path), "fingerprint": fp})
                continue

            seen_beat_ids.add(beat_id)
            seen_fingerprints.add(fp)
            wf.write(json.dumps(row) + "\n")
            rows_written += 1

report.write_text(json.dumps({
    "inputs": [str(p) for p in inputs],
    "rows_written": rows_written,
    "duplicate_beat_ids": duplicate_beat_ids,
    "duplicate_fingerprints": duplicate_fingerprints,
}, indent=2))

print(f"rows_written={rows_written}")
print(f"duplicate_beat_ids={len(duplicate_beat_ids)}")
print(f"duplicate_fingerprints={len(duplicate_fingerprints)}")
PY
```

Dedup guards:

- hard guard 1: duplicate `brief.beat_id`
- hard guard 2: duplicate normalized prose fingerprint across different bundles

If either count is non-zero, stop and inspect `merge-report.json`.

## 7. Training-data-ready exit condition

The corpus handoff is complete only when all of these are true:

1. every selected new bundle has `verification.json` with no hard failures
2. `novels/salvatore-v5-corpus/pairs.jsonl` exists
3. `novels/salvatore-v5-corpus/reports/merge-report.json` shows:
   - `duplicate_beat_ids = 0`
   - `duplicate_fingerprints = 0`
4. the merged corpus hash is recorded:

```bash
shasum -a 256 novels/salvatore-v5-corpus/pairs.jsonl
```

The resulting path + SHA256 is the handoff artifact for the human:

```text
novels/salvatore-v5-corpus/pairs.jsonl
sha256=<record terminal output here>
```

This runbook intentionally stops at the merged training-pairs artifact. Formatting to W&B chat JSONL and any submission approval happen later.

## 8. STOP

**Do not submit to W&B. That step requires user authorization per project policy.**

Do not run:

- `python3 scripts/finetune/train-lora.py ...`
- any `submit-...training.ts` script
- any DB write that allocates adapter registry rows

## 9. Rollback

Rollback is cheap because the Icewind Dale bundle stays untouched.

For a failed new bundle:

```bash
mv novels/salvatore-homeland novels/_failed-salvatore-homeland-$(date +%Y%m%d-%H%M%S)
rm -rf /tmp/beat-prompts-salvatore-homeland
rm -rf /tmp/beat-results-salvatore-homeland
rm -rf /tmp/brief-prompts-salvatore-homeland
rm -rf /tmp/brief-results-salvatore-homeland
```

Apply the same pattern to the affected bundle key only.

For a bad merged corpus:

```bash
rm -rf novels/salvatore-v5-corpus
```

Then rebuild the merge artifact from the verified per-book bundles.

Never delete or rewrite:

- `novels/salvatore-icewind-dale/`
- `novels/salvatore-icewind-dale/pairs.jsonl`
- `novels/salvatore-icewind-dale/verification.json`
