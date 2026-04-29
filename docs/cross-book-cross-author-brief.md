---
status: active
created: 2026-04-29
related: docs/corpus-structural-decomposition.md, docs/corpus-wide-analysis-todo.md
---

# Cross-book + cross-author calibration brief

## Why

The R7 charter's structural-fingerprint thesis — that per-book distributions (MICE balance, character-arc shape, McKee-gap density) can feed planner constraints — currently rests on a single book. A second Salvatore book tests whether the fingerprint is author-stable (not an accident of one novel); a non-Salvatore fantasy book tests whether it is author-distinctive (justifying per-`WRITER_GENRE_PACK` constraints rather than collapsing to generic-fantasy priors).

## Recommendation

Do Streams of Silver first. The canonical text is already on disk (`scripts/lora-data/salvatore-streams-of-silver.txt`, 104,451 words) and the bundle's `config.yml` already lists `streams_of_silver` as a registered book key — the normalization script (`normalize-for-structure.ts`) can run today. Stage 6 on Streams of Silver costs ~$2-3 and yields the stability signal within one session. Once those verdicts land, run the non-Salvatore comparison. Recommended non-Salvatore candidate: **Jim Butcher, Storm Front** (Dresden Files book 1, 2000). See rationale below.

---

## Streams of Silver — 2nd Salvatore book

**Acquisition:** Already done. `scripts/lora-data/salvatore-streams-of-silver.txt` exists (ingested 2026-04-15, report at `salvatore-streams-of-silver.report.json`). 104,451 words, 29 section markers, 47 scene breaks — the WotC EPUB required a custom image-to-ornament mapping, which is documented in `corpus-ingestion.md` and already applied. No re-purchase, no re-ingest.

**Stage 1-5 effort:** Stages 1-4 are complete for the trilogy as a unit (`beats.jsonl`, `pairs.jsonl`, `scenes.jsonl` all exist in `novels/salvatore-icewind-dale/`). Stage 5 analysis has run for crystal_shard. The only required work before Stage 6 is running `normalize-for-structure.ts --novel salvatore-icewind-dale --book streams_of_silver` to slice and sort the shared bundle by book key. That is a deterministic sub-second operation. No new LLM calls, no operator review gates.

**Stage 6 cost:** ~$2-3 total at current V4 Pro promo pricing (all 5 dims, extractor + judge pass). Breakdown based on crystal_shard actuals:
- Extraction (5 dims, V4 Flash): ~$0.40 (same scene/beat count — 104K words ≈ 140 scenes, 860 beats)
- Pro judge (3 dims needing Pro: value-charge, mice, mckee-gap): ~$1.20
- Character-arcs and promise can use Flash judge or Pro as needed: ~$0.30-0.50
- Total: ~$2.00-2.50 at promo; ~$4.50 after 2026-05-31

**What it tells us:** Whether crystal_shard's distributions are Salvatore-stable. If Streams of Silver produces CELL PASS on character-arcs (same F1=1.00 on 6-character identification + LTWN) and similar MICE/McKee-gap distributions (within 5pp), we can treat the Salvatore fingerprint as an author-level prior rather than a single-book artifact. If the distributions diverge materially (e.g. Streams is character-arc heavier, McKee-gap density is lower), each book needs its own constraint set and the planner priors are book-scoped, not author-scoped — a load-bearing architectural distinction.

---

## Cross-author candidate — Jim Butcher, Storm Front

**Candidate:** Jim Butcher, *Storm Front* (Dresden Files Book 1, 2000). Urban fantasy, ~90,000 words.

**Genre / length / why this one over the other candidates:**

- **Genre overlap with Salvatore:** Urban fantasy shares fantasy's structural DNA (quest object, magic system, monster antagonist) while being measurably distinct in setting (contemporary vs secondary world), POV convention (first-person vs third), and MICE emphasis (Idea-threads dominate urban fantasy vs Salvatore's Event-dominant action-pulp). That divergence is exactly what we want: enough shared genre framework that the extractors make meaningful comparisons, enough structural difference that non-overlap is informative rather than noise.

- **Sanderson Mistborn rejected:** Mistborn's structural choices (ensemble cast, systemic magic, 4-act structure) are deliberately different from Salvatore in ways that confound the comparison — any divergence could be a genre-packing choice rather than an author fingerprint. Also ~342K words for the full novel, 3× the per-scene LLM calls and 3× the cost. Storm Front is 90K, within 15% of crystal_shard's 105K.

- **Robertson Breakers rejected:** Modern self-pub thriller is too genre-distant from action-pulp fantasy. The MICE/value-charge distributions would almost certainly diverge dramatically, but the question is whether they diverge for structural reasons (different author fingerprint) or genre reasons (thriller vs fantasy). An urban-fantasy comparison keeps the genre signal cleaner.

- **Storm Front specific advantages:** (1) First-person close POV creates a maximally distinct POV convention from Salvatore's third-limited — the character-arc extractor will face a harder character-identification task, which tests whether the F1=1.00 result on crystal_shard holds under different POV conventions. (2) Dresden Files is a long-running series, so series-hook promises are structurally present, directly testing the promise dim's series-hook recall problem. (3) 90K words puts extraction cost at ~85-90% of crystal_shard's.

**Acquisition cost:** ~$9-15 (eBook). Available on Amazon/Apple Books/Kobo. Not public domain (2000 publication). EPUB format preferred (avoids PDF paragraph-break hazard documented in corpus-ingestion.md).

**Stage 1-5 effort:** Full pipeline from scratch. Stage 1 (ingest): ~30 minutes of wall-clock, one operator review to verify chapter count vs published TOC. Stages 2-4 (scenes, beats, briefs): ~4-5 hours wall-clock using Claude Code subagents per the corpus-pipeline.md Phase D pattern. Expected output: ~600 pairs (90K words / ~150 words/beat). Stage 5 analysis: ~30 minutes. Total author time: ~2 hours of oversight at review gates.

**What it tells us:** Whether Salvatore's structural fingerprint is author-distinctive or genre-typical. If Storm Front's MICE distribution, McKee-gap density, and character-arc shape are materially different from Salvatore's, the per-pack constraint architecture is justified — planners should use Salvatore-calibrated priors for fantasy seeds and would need separate priors for urban fantasy seeds. If the distributions are similar, genre-level constraints may suffice and the `WRITER_GENRE_PACKS` per-author granularity is over-specified. The first-person vs third-person POV distinction is also a direct calibration test for the character-arcs and McKee-gap extractors.

---

## Combined cost + timeline

| Work item | LLM cost | Author time | Wall-clock |
|---|---|---|---|
| Streams of Silver Stage 6 (5 dims) | ~$2.50 (promo) / ~$5 (post-promo) | ~30 min | ~3-4h |
| Storm Front acquisition | ~$12 | 5 min | — |
| Storm Front Stages 1-5 | ~$2 (DeepSeek subagents) | ~2h oversight | ~5-6h |
| Storm Front Stage 6 (5 dims) | ~$2.00 (promo) / ~$4 (post-promo) | ~30 min | ~3-4h |
| **Total** | **~$18-20 at promo** | **~3h** | **~12-14h** |

Post-2026-05-31 (promo end) the LLM cost roughly doubles to ~$30-35. Doing both before the promo deadline saves ~$15.

---

## Risks + open questions

- **Promise dim remains unstable.** Crystal_shard's promise dim is currently NULL-GOLD-like due to gold stochasticity (Pro judge self-consistency F1=0.326). Running the same dim on Streams of Silver before the ensemble-gold resolution (Phase C exit task) will produce another unstable verdict. Recommendation: skip promise on both new books until the ensemble-gold fix ships; run only value-charge, character-arcs, mice, and mckee-gap.

- **Streams of Silver scene-break count is low (47 vs 105 for crystal_shard).** The WotC EPUB's image-based scene breaks required custom extraction. If the existing canonical text missed any breaks, scene-level dims (value-charge, mice) may have artificially large scenes that aggregate multiple distinct charges. Worth verifying scene-break distribution in `salvatore-streams-of-silver.report.json` before running extractors.

- **Storm Front's first-person POV is an extractor stress test, not a calibration risk.** The character-arc extractor has been validated only on third-person limited. Flash's F1=1.00 on crystal_shard may degrade on first-person — plan for one round of prompt iteration if the character-arcs verdict drops to MARGINAL.

- **Author-distinctive vs genre-typical question requires a minimum of N=2 authors at similar genre distance.** Storm Front alone gives one data point. If Storm Front's distributions match Salvatore's, we'd want a third author (e.g. Gemmell, Legend) before concluding genre-level constraints suffice. Budget one more book if the Storm Front result is surprising.
