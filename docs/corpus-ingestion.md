# Corpus Ingestion Procedure

How to convert a purchased novel (PDF or EPUB) into a **training-ready bundle** at `novels/<key>/` that feeds voice LoRAs, planner structural priors, and character archetype work.

> **Architecture reference:** `docs/corpus-pipeline.md` defines the canonical pipeline — bundle format, 5 stages, 14 conservation invariants, verification gates. This document is the user-facing **how-to** — the recipe for running that architecture on a specific novel. Read the architecture doc first if you're designing new analyzers or touching the pipeline internals.

---

## End-to-end: add a new novel

The bundle CLI wraps every stage. Each stage is a separate command so you can sample-review between them.

```bash
# 1. Create the bundle directory + config
mkdir -p novels/gemmell-drenai/{source,analysis,reports,review}
cp ~/Downloads/legend.epub novels/gemmell-drenai/source/
# Write novels/gemmell-drenai/config.yml (see novels/salvatore-icewind-dale/config.yml as template):
#   - key, title, author, genre, subgenre
#   - source_files dict mapping book_key → source/<file>
#   - characters registry with aliases + archetypes (used for dialogue extraction)
#   - analyzers list (declares which Stage-5 analyzers run)
#   - review_gates (per-stage eyeball checkpoints)

# 2. Stage 1 — ingest source to canonical.txt (if you haven't pre-canonicalized)
python3 scripts/finetune/ingest-corpus.py \
  --input novels/gemmell-drenai/source/legend.epub \
  --output novels/gemmell-drenai/canonical.txt \
  --json

# 3. Stage 2 — scenes
bun scripts/corpus/run.ts --novel gemmell-drenai --stage scenes

# 4. Stage 3 — beats (Claude Code subagents)
bun scripts/corpus/run.ts --novel gemmell-drenai --stage beats-prepare \
  --prompt-dir /tmp/beat-prompts-gemmell --batch-size 5
# Dispatch N sub-agents against /tmp/beat-prompts-gemmell/ (one per batch)
bun scripts/corpus/run.ts --novel gemmell-drenai --stage beats-merge \
  --results-dir /tmp/beat-results-gemmell

# 5. Stage 4 — briefs (Claude Code subagents)
bun scripts/corpus/run.ts --novel gemmell-drenai --stage briefs-prepare \
  --prompt-dir /tmp/brief-prompts-gemmell --batch-size 20
# Dispatch sub-agents…
bun scripts/corpus/run.ts --novel gemmell-drenai --stage briefs-merge \
  --results-dir /tmp/brief-results-gemmell

# 6. Stage 5 — analysis (pending plugin framework; for now run individual analyzers)

# 7. Verify — all 14 conservation invariants
bun scripts/corpus/run.ts --novel gemmell-drenai --stage verify

# 8. Inspect
bun scripts/corpus/run.ts --novel gemmell-drenai --stage list
```

**Reference bundle:** `novels/salvatore-icewind-dale/` is the validated reference implementation. 2,470 training pairs across the Icewind Dale Trilogy, all invariants pass. Copy its `config.yml` as the template when adding a new novel.

**What the verify step gates:** training code must call `is_training_ready(novel_key)` before loading the bundle's pairs. Bundles that fail hard invariants (missing chapters, zero-beat scenes, malformed pairs, orphan training pairs) are refused. Soft warnings surface but don't block.

---

## Stage 1 deep-dive: PDF/EPUB → canonical.txt

The rest of this document covers Stage 1 — the raw source → canonical text conversion. Stages 2–5 are orchestrated by the bundle CLI above; their details live in `docs/corpus-pipeline.md`.

**Stage 1 is idempotent and repeatable** — re-running on the same input produces byte-identical output.

## Quick start

```bash
# EPUB
python3 scripts/finetune/ingest-corpus.py \
  --input ~/Downloads/the_book.epub \
  --output scripts/lora-data/the-book.txt \
  --start-marker "=== PART ONE ===" \
  --end-marker "=== ACKNOWLEDGMENTS ===" \
  --json

# PDF
python3 scripts/finetune/ingest-corpus.py \
  --input ~/Downloads/the_book.pdf \
  --output scripts/lora-data/the-book.txt \
  --json
```

`scripts/lora-data/` is **gitignored** — corpora are large and copyright-encumbered. They live on the LXC and on local machines, never in the repo.

## Output format

Every ingested file follows the same conventions:

```
=== Prelude ===            ← unnumbered front section
=== BOOK 1: Ten-Towns ===  ← major division (PDF style)
=== PART ONE ===           ← major division (EPUB style)
CHAPTER 1 — The Stooge     ← numbered chapter (PDF style with em-dash)
=== CHAPTER 1 TITLE ===    ← numbered chapter (EPUB style, kept as heading)

prose paragraph one.

prose paragraph two.

* * *                      ← scene break

prose paragraph three.

=== Epilogue ===           ← unnumbered back section
```

Downstream code parses these markers with two regexes:
- `=== [^=]+ ===|CHAPTER \d+[^\n]*` — section boundaries
- `* * *` — intra-chapter scene breaks

Stick to those marker shapes; if you hand-edit a corpus, preserve them exactly.

## Per-format extraction

### PDF (`extract_pdf` + `normalize_pdf_structure`)

- `pypdf` for the bulk; falls back to `pdfminer.six` per-page when pypdf returns empty (handles malformed pages — Salvatore Crystal Shard pages 42 and 66 needed this).
- Strips `\x0c` form-feed page separators.
- Heuristic chapter regex: number on its own line, title on its own line, content begins with capital letter OR opening quote (handles "13\nAs the Wielder Bids\n\"Gather…").
- Heuristic Prelude/Epilogue regex: previous line must end in `.!?"` to avoid in-prose false matches.
- Heuristic BOOK regex: matches `BOOK N:\nTitle\n` exactly.

### EPUB (`extract_epub`)

- `ebooklib` + BeautifulSoup walks the XHTML documents in spine order.
- Skips known front/back-matter doc names (`nav`, `cover`, `dedication`, `acknowledgements`, `about_*`, etc.).
- `<hr>` is treated as a scene break (universal across publishers).
- Paragraph classes containing `secbreak`, `scenebreak`, `sb`, `ornament`, `asterisk` also become scene breaks. Add new class names here when you encounter a new publisher.
- Headings (`h1`–`h4`) become `=== Heading Text ===` markers.

### Trimming

Most novels carry front matter (cover, copyright, dedication, epigraph) and back matter (acknowledgments, about-the-author, ads) that should not enter training. Use `--start-marker` and `--end-marker` to clip both ends. The script prints a WARN if either marker isn't found.

To find your markers, run once without trimming, eyeball the section list in the report, and re-run with the exact `=== Header ===` strings.

## Validation gates

The script prints WARNINGS when:
- Word count < 50,000 (suspicious for a novel)
- Section markers < 5 (chapter detection failed)
- Zero scene breaks (likely missed publisher-specific markup)

If any warning fires, **do not feed the file downstream**. Inspect the report and either:
1. Adjust trimming markers
2. Add the publisher's scene-break class to `extract_epub`
3. Tune the chapter regex in `normalize_pdf_structure` for that PDF's quirks

Then re-run with `--force` and re-validate.

## Paragraph-break hazard (READ BEFORE TRAINING)

PDF extraction routinely drops paragraph breaks in dialogue-heavy prose. `pypdf` emits one physical-PDF-line per `\n` and never promotes the turn-boundary breaks back into `\n\n`. EPUB ingestion is safer (paragraphs come from `<p>` tags) but custom-styled publishers can still collide.

**The Salvatore v1 LoRA shipped this bug.** 0/6 original-character Phase C.3 generations had a single blank line between speaker turns — the model had trained on the wall-of-text and learned to reproduce it. See `docs/voice-lora-salvatore.md` and the 2026-04-16 decisions entry for the full post-mortem.

**The guardrail** — every SFT formatter must call these before emitting training data:

```python
from paragraph_breaks import normalize_breaks, assert_minimum_coverage

for p in pairs:
    p["prose"] = normalize_breaks(p["prose"])

assert_minimum_coverage(
    [p["prose"] for p in pairs],
    min_blank_break_pct=0.50,       # total corpus floor
    dialogue_kinds=["dialogue"],     # dialogue-kind pairs must be ≥80%
    kinds=[p["brief"].get("kind") for p in pairs],
)
```

`normalize_breaks` is idempotent — running it on already-well-formed prose is a no-op. `assert_minimum_coverage` raises a `RuntimeError` if coverage drops below threshold. See `scripts/finetune/paragraph_breaks.py`.

**Upstream check for new ingests.** After running `ingest-corpus.py`, run this one-liner against the text output:

```bash
python3 - <<'PY' scripts/lora-data/<your-ingest>.txt
import sys
text = open(sys.argv[1]).read()
blocks = text.count("\n\n")
dialogue_turns = sum(text.count("\n" + q) for q in ('"', "\u2018", "\u201c"))
print(f"blank-line blocks: {blocks}")
print(f"lines starting with an opening quote: {dialogue_turns}")
print(f"dialogue-turn / block ratio: {dialogue_turns / max(1, blocks):.2f}")
PY
```

A healthy novel-length corpus has `\n\n` blocks ≥ 2000 and `dialogue-turns / blocks ≥ 0.15` (more for dialogue-heavy authors). If the block count is low or the ratio is near zero, inspect the raw output — the extractor probably lost breaks. Fix at this stage, not at training stage.

## Spot-check checklist

After validation passes, before running decomposition:

- [ ] Per-section word counts look reasonable (chapters should be 1.5K–10K words; outliers may indicate a missed chapter break)
- [ ] Scene-break density makes sense (most novels: 2–6 scenes per chapter average)
- [ ] First chapter starts with actual narrative prose, not a copyright blurb
- [ ] Last chapter ends with story content, not "About the Author"
- [ ] Number of chapters matches the published table of contents

The report is saved as `<output>.report.json` when `--json` is passed; archive it alongside the corpus so future decomposition runs can be sanity-checked against the original ingest.

## Downstream chunking strategy

Once a corpus is ingested, the **6-stage decomposition pipeline** (`docs/writer-imitation-benchmark.md` Phase 0a–0b) produces paired `(beat brief, real prose)` training examples:

| Stage | Granularity | Producer | Notes |
|---|---|---|---|
| 1. Mechanical split | Chapter | This script's `=== ... ===` markers | Free; deterministic |
| 2. Sub-agent scene segmentation | Scene (~500–1,500 words) | Claude Code sub-agent | Uses `* * *` markers as ground truth where present; infers POV/setting transitions where absent |
| 3. Beat segmentation | Beat (~150–400 words) | Claude Code sub-agent | One beat = one beat of dramatic action; ~2–6 beats per scene |
| 4. Beat brief extraction | Beat | Sub-agent | Output: characters present, POV, setting, action summary, transition seam |
| 5. Style tagging | Beat | Deterministic | Sentence length, dialogue ratio, sensory density, clause complexity |
| 6. Validation + merge | All | Deterministic + manual gate | Round-trip: can a writer reconstruct prose from the brief? |

Target output: ~600 paired beats per ~100K-word novel. Two novels → ~1,200 pairs = sufficient for a r=16 LoRA on Qwen3-14B (per `docs/writer-imitation-benchmark.md`).

**Chunking constraint for training:** the (brief + context + transition) prompt should fit comfortably under 4K tokens; the prose target output is one beat (~150–400 words ≈ 200–500 tokens). This stays within W&B Inference's hot-loaded context window without paying for the long-context tier.

## Per-source registry

Track every ingested novel here. Don't re-ingest without a reason — it changes the corpus and invalidates downstream eval comparisons.

| Title | Author | Series | Pub. | Format | Words | Sections | Scene breaks | Output | Ingested |
|---|---|---|---|---|---|---|---|---|---|
| The Crystal Shard | R. A. Salvatore | Icewind Dale, Book 1 | 1988 (TSR) | PDF | 105,352 | 37 (Prelude + 3 Books + 30 Ch + 3 Epilogues) | 105 | `scripts/lora-data/salvatore-crystal-shard.txt` | 2026-04-15 |
| Streams of Silver | R. A. Salvatore | Icewind Dale, Book 2 | 1989 (TSR) | EPUB (retail ADE, TOC + image-mapped) | 104,451 | 29 (Prelude + 3 Parts + 24 Chapters + Epilogue) | 47 | `scripts/lora-data/salvatore-streams-of-silver.txt` | 2026-04-15 |
| The Halfling's Gem | R. A. Salvatore | Icewind Dale, Book 3 | 1990 (TSR) | TXT | 96,967 | 32 (Prelude + 3 Books + 25 Chapters + 3 Epilogues) | 108 | `scripts/lora-data/salvatore-halflings-gem.txt` | 2026-04-15 |
| Pinquickle's Folly | R. A. Salvatore | The Buccaneers, Book 1 | 2024 (Saga Press) | EPUB | 106,508 | 22 (3 Parts + 19 Chapters) | 55 | `scripts/lora-data/pinquickles-folly.txt` | 2026-04-15 |

**WotC publisher quirk (Streams of Silver):** chapter headings AND scene-break ornaments are `<img>` tags, not text. Extraction required: (1) TOC-aware code to inject chapter titles from EPUB navigation, (2) image-filename mapping — `Salv_9780786954056_epub_003_r1.jpg` is the scene-break ornament, each chapter's first unique image is the heading. This recovered 47 scene breaks from what initially looked like 0. Custom extraction script was used (not the standard `ingest-corpus.py` pipeline). If ingesting other WotC Salvatore EPUBs, expect the same image-based pattern — identify the repeating ornament filename and map it to `* * *`.

When you add a new ingest, append a row above and commit this file along with any `ingest-corpus.py` changes the new source forced.

## Adding a new publisher's quirk

If a new EPUB has scene breaks that don't trigger:

1. Open the EPUB (`unzip -p file.epub OEBPS/ch01.xhtml | less`)
2. Find the markup the publisher uses (custom CSS class, image, special character)
3. Add the class name or pattern to `extract_epub` in `scripts/finetune/ingest-corpus.py`
4. Re-run on the affected corpus with `--force` and verify the scene-break count rises
5. Document the publisher quirk in this file

If a new PDF has chapter headings the regex misses:

1. Print the raw extracted text around a missing chapter (`grep -n -B2 -A2 "ChapterTitle" /tmp/raw.txt`)
2. Identify how that chapter's heading differs from the working pattern
3. Adjust `normalize_pdf_structure` — prefer **relaxing** the existing regex over adding a second one
4. Re-run all previously ingested PDFs and verify section counts didn't change (regression test)
