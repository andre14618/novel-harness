---
status: active
updated: 2026-04-17
---

# Corpus Pipeline — Canonical Architecture

**Purpose:** decompose proven novels into structured, verified, training-ready bundles so the harness can (a) train voice LoRAs on clean author corpora, (b) extract structural signatures that feed planner priors, and (c) compare novels to identify what makes commercial fiction commercially successful.

**Non-goal:** a general-purpose text-mining tool. This is purpose-built for transforming published genre fiction into material the harness can reason about.

---

## Design principles

1. **One novel = one self-contained bundle.** Everything the harness needs about a novel lives in `novels/<key>/`. No hidden dependencies on `/tmp` or global state.
2. **Every stage has a contract.** Inputs, outputs, and invariants are formalized. A stage either produces output that passes its contract or fails loudly.
3. **Never silently drop data.** Every filter, skip, or exception is surfaced in a per-stage `report.json`.
4. **Verification is a gate, not a suggestion.** Training code refuses to consume bundles that fail hard invariants. Soft warnings are shown but don't block.
5. **Pipeline versioning.** Every bundle records which pipeline version produced it. Prompt or schema changes → bundle marked stale → re-run triggered.
6. **Partial re-run.** If only 3 chapters failed, only re-run those 3. Cheap to iterate.

---

## Bundle format

```
novels/<novel-key>/
├── config.yml                    # per-novel metadata (see schema below)
├── source/                       # gitignored — original files
│   └── original.epub
├── canonical.txt                 # stage 1 output: canonical text
├── canonical.report.json
├── scenes.jsonl                  # stage 2 output: scenes with text
├── scenes.report.json
├── beats.jsonl                   # stage 3 output: segmented beats
├── beats.report.json
├── pairs.jsonl                   # stage 4 output: training pairs (brief + prose)
├── pairs.report.json
├── analysis/                     # stage 5 output: structural signatures
│   ├── structural-signature.json # beats-per-chapter, kind distribution, etc.
│   ├── voice-signature.json      # character speech patterns, dialogue density
│   └── dialogue-extract.jsonl    # per-character attributed dialogue (for archetype work)
├── verification.json             # output of verify-pipeline.py
└── pipeline_version.json         # { pipeline_version: "1.0", git_commit: "abc123",
                                  #   stages_completed_at: {...}, prompts_hash: "..." }
```

**Gitignore rules:** `novels/*/source/` and `novels/*/canonical.txt` (copyrighted text). `novels/*/config.yml`, `novels/*/reports/*.json`, `novels/manifest.json`, and all `*.report.json` files are tracked.

`scenes.jsonl`, `beats.jsonl`, `pairs.jsonl` contain verbatim prose → gitignored, but their `.report.json` siblings are tracked so we can audit bundle state without shipping copyrighted text.

---

## Per-novel `config.yml` schema

```yaml
# novels/salvatore-icewind-dale/config.yml
key: salvatore-icewind-dale
title: "The Icewind Dale Trilogy"
author: "R.A. Salvatore"
genre: fantasy
subgenre: action-pulp-fantasy
year: 1988
source_file: source/original.epub
source_format: epub

# Ingestion hints
ingestion:
  start_marker: "=== Prelude ==="
  end_marker: "=== Acknowledgments ==="
  chapter_detection: auto      # or "custom" with a regex override

# Structural metadata (populated post-analysis)
structural_signature: analysis/structural-signature.json
voice_signature: analysis/voice-signature.json

# Training intent
training_roles:
  - voice_lora                 # this novel is fit material for voice-LoRA training
  - structural_signature       # this novel's structure informs planner priors

# Character registry (populated during analysis, hand-curated after)
characters:
  - name: Drizzt Do'Urden
    aliases: ["Drizzt", "the drow", "the dark elf", "the ranger"]
    role: protagonist
    archetype: stoic_ranger
  - name: Bruenor Battlehammer
    aliases: ["Bruenor", "the dwarf"]
    role: supporting
    archetype: gruff_mentor
  # ...
```

**Why YAML:** humans edit this. The alias list for role-description extraction, archetype tags for training-data labeling — these want human review.

---

## The five stages

### Stage 1 — Ingestion (source → canonical text)

**Script:** `scripts/finetune/ingest-corpus.py` (existing, needs generalization per Phase B)

**Input:** `source/original.{epub,pdf,txt}` + `config.ingestion` hints

**Output:** `canonical.txt` in the canonical format described in `docs/corpus-ingestion.md`

**Contract:**
- Every `CHAPTER N` heading in the source is represented.
- `=== Prelude ===`, `=== Part N ===`, `=== Epilogue ===` preserved.
- Scene breaks (`* * *`) preserved.
- No copyrighted content stripped except DRM/cover/TOC/acks.

**Report:** `canonical.report.json` — character count, word count, section markers, chapter count, scene breaks, EPUB docs skipped and why.

**Invariants:**
- `I1.1`: canonical.txt exists and is non-empty
- `I1.2`: canonical.txt contains ≥50K words (sanity: a real novel)
- `I1.3`: canonical.txt contains ≥5 chapter markers

### Stage 2 — Scene extraction (canonical text → scenes with text)

**Script:** `scripts/finetune/extract-scenes.py` (existing, just fixed)

**Output:** `scenes.jsonl` — one row per scene with `{book, chapter, chapter_title, scene_idx, words, boundary, text}`

**Contract:**
- Every chapter in `canonical.txt` appears in `scenes.jsonl` (no silent drops).
- No word-count filtering by default; filters logged if applied.
- Boundary types preserved as metadata but never used as silent filters.

**Report:** `scenes.report.json` — per-book totals, dropped items by reason, boundary distribution, missing-chapter warnings.

**Invariants:**
- `I2.1`: every chapter in canonical.txt has ≥1 scene
- `I2.2`: total scene word count ≥ 90% of canonical word count (the ≤10% gap is section-marker text and scene-break separators)
- `I2.3`: no scene has empty or whitespace-only text

### Stage 3 — Beat segmentation (scenes → beats)

**Script:** `scripts/finetune/segment-beats.py` (existing, fixed)

**Output:** `beats.jsonl` — one row per beat, ~80–140w each

**Contract:**
- Every scene produces ≥1 beat.
- Every word in the scene appears in exactly one beat (verifiable by reconstruction).
- All beats have required schema fields.
- Claude Code subagent failures are surfaced, not swallowed.

**Report:** `beats.merge-report.json` — scenes missing results, scenes with zero valid beats, orphan results, malformed results, merge statistics.

**Invariants:**
- `I3.1`: every scene has ≥1 beat
- `I3.2`: reconstructed beat text ≥95% of scene text (word-level, modulo whitespace normalization)
- `I3.3`: every beat has all required fields (`beat_idx`, `words`, `kind`, `boundary_signal`, `summary`, `first_sentence`, `last_sentence`, `text`)
- `I3.4`: beat word counts fall in 30–300w range (outside = flag for review)
- `I3.5`: median beat size is 80–140w (matches training expectations)

### Stage 4 — Brief extraction (beats → training pairs)

**Script:** `scripts/finetune/extract-briefs.py` (existing, just fixed)

**Output:** `pairs.jsonl` — `{brief: {characters, pov, setting, tone, transition_in, ...}, prose: <beat text>}`

**Contract:**
- Every beat produces exactly one training pair.
- Briefs have all required fields.
- Character names in `brief.characters` come from the per-novel config's character registry (or are explicitly flagged as unknown).

**Report:** `pairs.merge-report.json` — beats without briefs, orphan briefs, malformed briefs.

**Invariants:**
- `I4.1`: 1:1 mapping between beats and pairs
- `I4.2`: every brief has all required fields
- `I4.3`: `brief.pov` is either in the novel's character registry or `"omniscient"`
- `I4.4`: characters mentioned in `brief.characters` are either in the registry or flagged

### Stage 5 — Analysis (training pairs → structural/voice signatures)

**Scripts:** `scripts/analysis/beat-sequence-analysis.py` (existing), `scripts/finetune/archetype-poc/extract-dialogue.py` (new, needs generalization)

**Outputs:**
- `analysis/structural-signature.json` — beats-per-chapter stats, kind distribution, cluster-sustain rates, opener/closer patterns
- `analysis/voice-signature.json` — per-character dialogue density, vocabulary distinctness, dialect markers
- `analysis/dialogue-extract.jsonl` — per-character attributed dialogue lines

**Contract:**
- Every named character in the novel's `config.characters` appears in voice-signature (or is explicitly marked as having insufficient data).
- Structural signature is consumable by `src/models/roles.ts` as a `StructuralPriors` object.

**Report:** `analysis/analysis.report.json` — per-character dialogue counts, coverage gaps.

**Invariants:**
- `I5.1`: structural signature has non-zero values for all kind categories
- `I5.2`: at least 60% of `config.characters` have sufficient dialogue data (≥30 attributed lines) — warning, not blocker

---

## Verification suite — the 14 invariants

`verify-pipeline.py --novel <key>` runs all stages' invariants as a single report:

```
Novel: salvatore-icewind-dale
Pipeline version: 1.0
Generated: 2026-04-17T14:23:00Z

=== Stage 1: Ingestion ===
  [PASS] I1.1: canonical.txt exists and non-empty (307,709 words)
  [PASS] I1.2: word count ≥50K
  [PASS] I1.3: 79 chapter markers detected

=== Stage 2: Scene Extraction ===
  [PASS] I2.1: all 79 chapters have ≥1 scene
  [PASS] I2.2: scene word count 98.4% of canonical
  [PASS] I2.3: no empty scenes

=== Stage 3: Beat Segmentation ===
  [FAIL] I3.1: 22 scenes have zero beats (list in report)
  [FAIL] I3.2: beat reconstruction covers 28% of scene text
  [PASS] I3.3: all beats have required fields
  [WARN] I3.4: 3 beats outside 30-300w range
  [PASS] I3.5: median beat size 105w

=== Stage 4: Brief Extraction ===
  [PASS] I4.1: 1:1 beat-pair mapping
  ...

=== TRAINING-READINESS GATE ===
  HARD FAILURES: 2  →  BLOCKED. Cannot train on this bundle.
  Run: python3 scripts/finetune/segment-beats.py <novel-key> to complete stage 3.
```

**Hard-fail invariants** (block training): I1.1, I2.1, I3.1, I3.2, I4.1, I4.2

**Soft-warn invariants** (show, don't block): I3.4, I3.5, I5.2 and everything else.

The training-readiness gate is a function: `is_training_ready(novel_key) → (bool, list_of_blockers)`. Training scripts call this before loading the pairs file.

---

## Pipeline versioning

Every bundle carries `pipeline_version.json`:

```json
{
  "pipeline_version": "1.0",
  "git_commit": "a8b1c41...",
  "stages_completed_at": {
    "ingest": "2026-04-17T10:00Z",
    "scenes": "2026-04-17T10:05Z",
    "beats": "2026-04-17T12:30Z",
    "briefs": "2026-04-17T13:00Z",
    "analysis": "2026-04-17T13:15Z"
  },
  "prompts_hash": {
    "beat_segmentation_prompt_sha": "abc...",
    "brief_extraction_prompt_sha": "def..."
  }
}
```

**Staleness detection:** if the current `prompts_hash` for the beat-segmentation prompt differs from the bundle's recorded hash, the bundle is stale for stage 3+. Tool: `bun scripts/corpus/check-staleness.ts` lists all bundles needing re-run.

**Version bumps:**
- Major (1.0 → 2.0): schema change — all bundles must re-run stages 3+.
- Minor (1.0 → 1.1): prompt tweak — only affected stages re-run.

---

## CLI — the user-facing interface

```bash
# Add a new novel
bun scripts/corpus/add-novel.ts \
  --key gemmell-drenai \
  --source ~/Downloads/legend.epub \
  --author "David Gemmell" \
  --genre fantasy

# Run a specific stage (or all)
bun scripts/corpus/run.ts --novel gemmell-drenai --stage all
bun scripts/corpus/run.ts --novel gemmell-drenai --stage beats

# Partial re-run (specific chapters)
bun scripts/corpus/run.ts --novel gemmell-drenai --stage beats --chapters 5,8,12

# Verify
bun scripts/corpus/verify.ts --novel gemmell-drenai

# Mark ready for training (after human review, if review gate enabled)
bun scripts/corpus/approve.ts --novel gemmell-drenai

# List all novels + training readiness
bun scripts/corpus/list.ts
```

Under the hood, these TypeScript wrappers call the existing Python scripts with the right paths. The CLI is the new surface; the Python scripts are the engine.

---

## Human-in-the-loop review gates

Optional gates between stages, configurable per-novel via `config.yml`:

```yaml
review_gates:
  after_scenes: false       # auto-advance
  after_beats: true         # sample 5 beats, human approves before stage 4 runs
  after_analysis: true      # review the structural signature before it feeds planner priors
```

When a gate is active and the stage completes, `run.ts` pauses with:
```
Bundle: gemmell-drenai
Stage 3 (beats) complete. 5 sampled beats written to novels/gemmell-drenai/review/beats-sample.txt
Review, then run: bun scripts/corpus/approve-stage.ts --novel gemmell-drenai --stage beats
```

---

## Design decisions (resolved)

1. **Storage:** Filesystem. `novels/<key>/` structure. Per-novel bundle self-contained. Simpler than DB for a corpus that's naturally file-shaped.
2. **Registration:** `novels/manifest.json` at the root lists all novels with their status. Updated automatically by `add-novel.ts`. No separate DB table — filesystem is the source of truth.
3. **Versioning:** `pipeline_version.json` per bundle with git commit + prompt hashes. Staleness is detectable and reportable.
4. **Partial re-run:** Yes, stages accept `--chapters` or `--scenes` filters.
5. **Review gates:** Configurable per-novel. Default off; enable for novels where output quality is critical.
6. **Multi-novel training sets:** Each novel is a bundle; training data assembly is a separate step that combines N bundles based on genre/author/intent filters. Lives outside the pipeline (training-data assembly is a separate concern from corpus ingestion).

---

## Migration plan — current state → this architecture

**We are here:** one partially-ingested Salvatore corpus, scripts hardcoded to Salvatore paths, some silent-drop bugs fixed, no bundle structure, no central registry.

**Target:** Salvatore bundle at `novels/salvatore-icewind-dale/` with all invariants passing, pipeline generalized so `novels/gemmell-drenai/` can be added next.

### Phase B — Generalize scripts (~1 day)

1. Add `novels/` directory structure + `novels/manifest.json`
2. Migrate Salvatore artifacts into `novels/salvatore-icewind-dale/`
3. Refactor `extract-scenes.py`, `segment-beats.py`, `extract-briefs.py` to take `--novel <key>` and read paths from the bundle's `config.yml`
4. Refactor prompts to template-inject author/title from `config.yml` instead of hardcoding Salvatore
5. Create the TypeScript CLI wrappers (`scripts/corpus/run.ts`, `verify.ts`, `add-novel.ts`, `list.ts`)

**Deliverable:** same functionality, generalized. Salvatore bundle exists and is runnable end-to-end.

### Phase C — Complete verification (~half day)

1. Implement all 14 invariants in `scripts/finetune/verify-pipeline.py` (or split into `scripts/corpus/verify/`)
2. Add the training-readiness gate predicate
3. Wire the gate into `format-salvatore-v3-sft.py` (and future training scripts) — refuse to load stale/incomplete bundles

**Deliverable:** `bun scripts/corpus/verify.ts --novel salvatore-icewind-dale` produces a full pass/fail report; broken bundles can't reach training.

### Phase D — Re-ingest Salvatore end-to-end (~1 day, mostly subagent wall-clock)

1. Re-run stage 2 (scenes) — already fixed, just re-run
2. Re-run stage 3 (beats) on all new scenes — Claude Code subagents, ~2h wall time
3. Re-run stage 4 (briefs) on all new beats — subagents, ~1h
4. Run stage 5 analysis
5. Run verification — all invariants pass

**Deliverable:** a clean Salvatore bundle, reference implementation for future novels.

### Phase E — Extend to additional proven novels (ongoing)

Each new novel: ~4 hours of clock time (mostly subagent wall-clock), ~$10–20 in API cost, a few minutes of human review at the gates.

Targets after Salvatore (per `docs/todo.md`):
- Gemmell Drenai series (action-pulp comparison to Salvatore)
- LitRPG representative (Dungeon Crawler Carl, He Who Fights With Monsters, or Defiance of the Fall)
- Modern epic fantasy (Sanderson or Rothfuss)

Each produces a structural signature → fed into `src/models/roles.ts` as a `StructuralPriors` object → planner uses genre-appropriate priors when that genre is routed.

---

## Open questions for future work (not blocking Phase B)

- **Cross-novel training sets:** when multiple LitRPG novels are bundled, do we train one LoRA on all of them, or separate LoRAs per author? Deferred until we have ≥2 bundles per genre.
- **Series vs standalone:** a trilogy (like Salvatore's) vs a single novel — do we bundle each book separately or as one mega-novel? Current: mega-bundle for trilogies. Reconsider if voice drifts across books.
- **Dialogue-extract portability:** the per-character dialogue extraction (from the archetype-pass POC work) becomes a stage 5 analysis artifact. Is the attribution protocol the same across novels, or does each novel need per-character regex tuning? Probably needs config override for non-standard attribution styles.
- **Quality bar for "proven":** what makes a novel eligible for the bundle set? Publishing history? Sales? Critical reception? Needs a curation policy.

---

## Summary

**This document defines the system you need.** The 5 stages are formalized, 14 invariants are explicit, the bundle format is canonical, and the migration plan (B → C → D → E) is concrete. Implementation should follow the phased order, with each phase's deliverable reviewable before the next starts.

**Next step after alignment on this doc:** Phase B — generalize the scripts and create the first bundle structure for Salvatore.
