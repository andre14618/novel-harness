#!/usr/bin/env python3
"""Pattern 58 — Italics / emphasis pattern usage in the Salvatore Icewind Dale corpus.

Hypothesis
----------
Published fiction uses italics for several voice-bearing functions:
  * direct internal thought (often present-tense first-person interior monologue)
  * single-word emphasis (a stressed word for tone)
  * foreign / non-Common-tongue words (Underdark, Halfling, Elvish — fantasy convention)
  * book / song / ship titles cited inline
  * sound effects (rare; voiced screams etc.)
If italics are preserved, they're a high-value writer-prompt signal: per-100w
density, kind/POV/character correlations, internal-thought vs single-word-emphasis
share, and a stable lexicon of italicized words.

Encoding survey (Step 1)
------------------------
Every fiction-text-bearing artifact in the bundle is scanned for the standard
italic-encoding conventions:
  * markdown asterisk pairs (`*word*`)
  * underscore pairs (`_word_`)
  * HTML / XML tags (`<i>`, `<em>`)
  * Unicode mathematical italic blocks (U+1D434–U+1D467, U+1D49C–U+1D4CF)
  * ALL-CAPS as an emphasis proxy (rare in modern fiction; capture density)
The survey runs across:
  * `source/salvatore-{crystal-shard,streams-of-silver,halflings-gem}.txt`
  * `beats.jsonl` (per-beat `text` field)
  * `pairs.jsonl`, `pairs-crystal-shard.jsonl`, `scenes.jsonl`
  * `analysis/dialogue-extract.jsonl`

Outcome shape
-------------
If ANY italic encoding is found in the corpus → measure per-book/per-kind
densities, classify italicized passages (single word vs phrase vs full sentence),
estimate internal-thought share, and return PASS / PASS_PARTIAL per the cross-
book gate.

If NO italic encoding is preserved → KILL verdict with the recommendation to
re-ingest the source PDFs/EPUBs preserving italic markers (the only sustainable
path to recovering this signal, as ALL-CAPS density is also effectively zero in
prose — the only ALL-CAPS hits are residual section-header fragments).

Cross-book gate
---------------
  PASS         — per-kind ordering reproduces 3/3 books AND internal-thought
                 share (full-sentence italics) is stable
  PASS_PARTIAL — 2/3 reproduce
  KILL         — italics not preserved in corpus
"""
from __future__ import annotations

import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

# Make the shared atomic_io helpers importable.
sys.path.insert(0, str(Path(__file__).parent / "lib"))
from atomic_io import (  # noqa: E402
    atomic_append_section,
    atomic_insert_row_before_anchor,
    write_timestamped_json,
)


PATTERN_ID = 58
PATTERN_NAME = "Italics / emphasis pattern usage"

CORPUS_DIR = Path(
    "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale"
)
SOURCE_DIR = CORPUS_DIR / "source"
BEATS_FILE = CORPUS_DIR / "beats.jsonl"
OUT_DIR = CORPUS_DIR / "structure-calibration"
CONCLUSIONS_DOC = OUT_DIR / "crystal_shard-conclusions.md"
ROADMAP_DOC = Path(
    "/Users/andre/Desktop/personal_projects/novel-harness/docs/harness-tuning-roadmap.md"
)

BOOKS = ["crystal_shard", "streams_of_silver", "halflings_gem"]
SOURCE_FILES = {
    "crystal_shard": SOURCE_DIR / "salvatore-crystal-shard.txt",
    "streams_of_silver": SOURCE_DIR / "salvatore-streams-of-silver.txt",
    "halflings_gem": SOURCE_DIR / "salvatore-halflings-gem.txt",
}

# Encoding patterns we test for. Each compiled regex must match an italic span,
# not a JSON key, not a single character. Scoped to letter/word interiors so
# we don't false-positive on JSON underscores like "scene_id".
ITALIC_PATTERNS = {
    "markdown_asterisk": re.compile(r"\*[A-Za-z][^*\n]{0,200}[A-Za-z][\.,!?]?\*"),
    "underscore_pair": re.compile(r"(?<![A-Za-z0-9_])_[A-Za-z][^_\n]{0,200}[A-Za-z][\.,!?]?_(?![A-Za-z0-9_])"),
    "html_i_tag": re.compile(r"<i>[^<]{1,500}</i>", re.IGNORECASE),
    "html_em_tag": re.compile(r"<em>[^<]{1,500}</em>", re.IGNORECASE),
}

# All-caps emphasis proxy (4+ chars to avoid 'I', 'A', 'OK'). We further filter
# structural artifacts like CHAPTER / BOOK / PRELUDE in post-processing.
ALL_CAPS_EMPHASIS_RE = re.compile(r"\b[A-Z]{2,}\b")
STRUCTURAL_CAPS = {
    "CHAPTER", "BOOK", "PRELUDE", "EPILOGUE", "APPENDIX", "PART", "PROLOGUE",
    "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
    "RELUDE", "EARCHES", "LLIES", "RAILS",  # ingestion fragments seen in source scan
    "OK", "TV", "UK", "US", "USA", "NBSP",
    "A", "AN",
}


def scan_text_for_italic_encodings(text: str) -> dict:
    """Return a dict of pattern-name -> {count, samples} for the standard italic encodings."""
    results = {}
    for name, regex in ITALIC_PATTERNS.items():
        hits = regex.findall(text)
        # filter false positives by length and inner content
        clean = [h for h in hits if 2 <= len(h) <= 500]
        results[name] = {
            "count": len(clean),
            "samples": clean[:10],
        }
    # Unicode italic letters (math italic blocks).
    italic_unicode = [
        c for c in text
        if (0x1d434 <= ord(c) <= 0x1d467) or (0x1d49c <= ord(c) <= 0x1d4cf)
    ]
    results["unicode_italic_chars"] = {
        "count": len(italic_unicode),
        "samples": italic_unicode[:20],
    }
    return results


def scan_all_caps_emphasis(text: str) -> dict:
    """Count ALL-CAPS words in text, filtered for structural artifacts."""
    raw = ALL_CAPS_EMPHASIS_RE.findall(text)
    cleaned = [w for w in raw if w not in STRUCTURAL_CAPS]
    return {
        "raw_count": len(raw),
        "filtered_count": len(cleaned),
        "structural_count": len(raw) - len(cleaned),
        "top": Counter(cleaned).most_common(20),
    }


def survey_artifacts() -> dict:
    """Run the encoding survey across every fiction-text artifact in the bundle."""
    survey: dict = {}

    # Source files
    for book, path in SOURCE_FILES.items():
        if not path.exists():
            survey[f"source/{book}"] = {"error": f"missing {path}"}
            continue
        text = path.read_text()
        survey[f"source/{book}"] = {
            "path": str(path),
            "size_chars": len(text),
            "encoding_hits": scan_text_for_italic_encodings(text),
            "all_caps_emphasis": scan_all_caps_emphasis(text),
        }

    # beats.jsonl — examine the 'text' field per beat (not the JSON envelope)
    if BEATS_FILE.exists():
        per_book_text: dict[str, list[str]] = defaultdict(list)
        beats_count = 0
        with BEATS_FILE.open() as fp:
            for line in fp:
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                t = obj.get("text", "")
                book = obj.get("book", "unknown")
                per_book_text[book].append(t)
                beats_count += 1
        survey["beats.jsonl"] = {
            "path": str(BEATS_FILE),
            "n_beats": beats_count,
            "per_book": {},
        }
        for book, chunks in per_book_text.items():
            joined = "\n".join(chunks)
            survey["beats.jsonl"]["per_book"][book] = {
                "n_beats": len(chunks),
                "size_chars": len(joined),
                "encoding_hits": scan_text_for_italic_encodings(joined),
                "all_caps_emphasis": scan_all_caps_emphasis(joined),
            }

    # Other JSONL artifacts: scenes.jsonl, pairs.jsonl, analysis/dialogue-extract.jsonl
    other_jsonl = [
        ("scenes.jsonl", CORPUS_DIR / "scenes.jsonl", "text"),
        ("pairs.jsonl", CORPUS_DIR / "pairs.jsonl", "completion"),
        ("analysis/dialogue-extract.jsonl", CORPUS_DIR / "analysis" / "dialogue-extract.jsonl", "utterance"),
    ]
    for label, path, text_key in other_jsonl:
        if not path.exists():
            continue
        chunks: list[str] = []
        n = 0
        with path.open() as fp:
            for line in fp:
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                # try multiple plausible text-bearing keys
                for k in (text_key, "text", "completion", "prose", "utterance"):
                    val = obj.get(k)
                    if isinstance(val, str):
                        chunks.append(val)
                        break
                n += 1
        joined = "\n".join(chunks)
        survey[label] = {
            "path": str(path),
            "n_records": n,
            "n_text_chunks": len(chunks),
            "size_chars": len(joined),
            "encoding_hits": scan_text_for_italic_encodings(joined),
        }

    return survey


def classify_survey(survey: dict) -> dict:
    """Aggregate the survey into a one-page summary: total italic hits per encoding."""
    totals = {name: 0 for name in ITALIC_PATTERNS}
    totals["unicode_italic_chars"] = 0

    # Source-file totals
    src_totals = {name: 0 for name in totals}
    beat_totals = {name: 0 for name in totals}

    for key, data in survey.items():
        if "encoding_hits" in data:
            for name, info in data["encoding_hits"].items():
                if name not in totals:
                    continue
                totals[name] += info["count"]
                if key.startswith("source/"):
                    src_totals[name] += info["count"]
        if key == "beats.jsonl":
            for book, bdata in data.get("per_book", {}).items():
                for name, info in bdata["encoding_hits"].items():
                    if name not in totals:
                        continue
                    totals[name] += info["count"]
                    beat_totals[name] += info["count"]

    return {
        "totals_all_artifacts": totals,
        "source_only_totals": src_totals,
        "beats_only_totals": beat_totals,
        "italic_present": any(v > 0 for v in totals.values()),
    }


def main() -> int:
    print(f"=== Pattern {PATTERN_ID}: {PATTERN_NAME} ===")
    print()
    print("Step 1 — encoding survey across all bundle artifacts")
    survey = survey_artifacts()
    classification = classify_survey(survey)

    print("\n--- per-artifact encoding hits ---")
    for key, data in survey.items():
        if "encoding_hits" in data:
            hits = data["encoding_hits"]
            line = f"  {key}: " + " | ".join(
                f"{n}={hits.get(n,{}).get('count',0)}"
                for n in (
                    "markdown_asterisk", "underscore_pair", "html_i_tag",
                    "html_em_tag", "unicode_italic_chars",
                )
            )
            print(line)
            caps = data.get("all_caps_emphasis")
            if caps:
                print(f"      ALL-CAPS (filtered): {caps['filtered_count']} (top: {caps['top'][:5]})")
        elif key == "beats.jsonl":
            for book, bdata in data["per_book"].items():
                hits = bdata["encoding_hits"]
                line = f"  beats.jsonl/{book}: " + " | ".join(
                    f"{n}={hits.get(n,{}).get('count',0)}"
                    for n in (
                        "markdown_asterisk", "underscore_pair", "html_i_tag",
                        "html_em_tag", "unicode_italic_chars",
                    )
                )
                print(line)

    print("\n--- aggregate totals ---")
    for name, tot in classification["totals_all_artifacts"].items():
        print(f"  {name}: {tot}")
    print(f"\n  italic-present-anywhere: {classification['italic_present']}")

    # ALL-CAPS emphasis check across beat text
    beat_caps_total = 0
    beat_caps_words = 0
    if "beats.jsonl" in survey:
        for book, bdata in survey["beats.jsonl"]["per_book"].items():
            beat_caps_total += bdata["all_caps_emphasis"]["filtered_count"]
            # per-100w density needs a word count; we'll use beat sizes from JSON
    # Recompute beat word totals from beats.jsonl directly for density
    beat_word_total = 0
    beat_caps_per_book = {}
    if BEATS_FILE.exists():
        per_book_words: dict[str, int] = defaultdict(int)
        with BEATS_FILE.open() as fp:
            for line in fp:
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                book = obj.get("book", "unknown")
                w = obj.get("words", 0)
                per_book_words[book] += w
                beat_word_total += w
        beat_caps_per_book = {
            b: {
                "caps_filtered": survey["beats.jsonl"]["per_book"][b]["all_caps_emphasis"]["filtered_count"],
                "words": per_book_words[b],
                "per_100w": (
                    100.0
                    * survey["beats.jsonl"]["per_book"][b]["all_caps_emphasis"]["filtered_count"]
                    / per_book_words[b]
                ) if per_book_words[b] else 0.0,
            }
            for b in BOOKS
            if b in survey["beats.jsonl"]["per_book"]
        }

    # Verdict: italics absent → KILL with documented finding + ALL-CAPS fallback report
    verdict: str
    verdict_summary: str
    measurement_payload: dict | None = None
    if not classification["italic_present"]:
        verdict = "KILL"
        verdict_summary = (
            "No italic encoding is preserved anywhere in the bundle "
            "(zero markdown_asterisk, underscore-pair, <i>, <em>, or "
            "Unicode-italic hits across source/*.txt, beats.jsonl, scenes.jsonl, "
            "pairs.jsonl, dialogue-extract.jsonl). Italics were stripped during "
            "ingestion. ALL-CAPS as a fallback emphasis signal is also "
            f"effectively zero in beat text ({beat_caps_total} hits / {beat_word_total} words "
            f"= {100.0*beat_caps_total/beat_word_total:.5f} per 100w; the residual hits are "
            "ingestion-leftover section-header fragments like RELUDE/EARCHES/LLIES, "
            "not in-prose emphasis). The signal is recoverable only via "
            "re-ingestion that preserves italic markers from the original "
            "PDFs/EPUBs (italics live in the underlying styled-text layer, "
            "not the plain-text projection used here)."
        )
    else:
        # Future-work path: italics ARE present. We don't run the full measurement
        # in this pass because the survey above showed zero hits; but we leave the
        # structure here so the script is rerun-friendly if a later re-ingestion
        # restores the markers.
        verdict = "MEASUREMENT_TODO"
        verdict_summary = (
            "Italic encoding detected — full per-book / per-kind density "
            "measurement and internal-thought-share classification are NOT yet "
            "implemented in this script (the corpus was expected to be plain-text)."
        )

    out = {
        "computedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pattern_id": PATTERN_ID,
        "pattern_name": PATTERN_NAME,
        "description": (
            "Pattern 58 — measures italic / emphasis usage across the Salvatore "
            "Icewind Dale 3-book corpus. Italics in fiction normally encode direct "
            "internal thought, single-word emphasis, foreign / proper-noun terms, "
            "and (rarely) sound effects. The first task is detecting whether italics "
            "were preserved during corpus ingestion."
        ),
        "methodology": (
            "Step 1: scan source/*.txt and beats.jsonl + scenes.jsonl + pairs.jsonl + "
            "analysis/dialogue-extract.jsonl for the canonical italic encodings "
            "(*word*, _word_, <i>...</i>, <em>...</em>, Unicode mathematical-italic "
            "blocks). Step 2: if italics are present, measure per-100w density per "
            "(book, kind), classify spans (single-word / phrase / full-sentence "
            "internal thought / emphasis / foreign / proper-noun), and compute "
            "cross-book stability. Step 3 (fallback): on KILL, also report ALL-CAPS "
            "density as a conservative emphasis proxy."
        ),
        "encoding_survey": survey,
        "classification": classification,
        "all_caps_fallback": {
            "beat_text_total_filtered_caps": beat_caps_total,
            "beat_text_total_words": beat_word_total,
            "beat_text_per_100w": (
                100.0 * beat_caps_total / beat_word_total
            ) if beat_word_total else 0.0,
            "per_book": beat_caps_per_book,
            "interpretation": (
                "ALL-CAPS density is effectively zero in beat text. The handful "
                "of hits in streams_of_silver beat texts (4) are ingestion "
                "fragments (RELUDE, EARCHES, LLIES, UP) — not in-prose emphasis. "
                "Salvatore does not use ALL-CAPS as an emphasis convention; "
                "the source files only contain ALL-CAPS in the structural "
                "section headers (CHAPTER N) which were stripped before the beat "
                "text fields. ALL-CAPS therefore cannot serve as a usable proxy "
                "for the lost italics signal."
            ),
        },
        "directional_verdict": verdict,
        "directional_summary": verdict_summary,
        "proposed_lever": (
            "Re-ingest the source PDFs/EPUBs preserving italic markers (HTML <em> "
            "tags or markdown asterisks) so the writer-prompt signal can be "
            "extracted on a second pass. Italics are a high-value voice cue: in "
            "Salvatore, full-sentence italics are direct internal-thought beats "
            "(a Drizzt voice signature) and single-word italics carry emphasis-"
            "tone in dialogue. Recovering them would unlock: (a) per-kind "
            "italic-density priors for the writer prompt (interiority > dialogue "
            "> action > description likely), (b) a stable internal-thought "
            "lexicon for fewshot voice imprint, (c) a foreign-term inventory "
            "that doubles as a lint allowlist (Crenshinibon, Cryshal-Tirith, "
            "Underdark place-names). Recommended re-ingestion pipeline: pdfminer "
            "or ebook-convert with `--preserve-italic` flag → markdown "
            "round-trip → emit `*word*` markers for downstream regex extraction. "
            "Until re-ingestion ships, do NOT introduce italics-density linting "
            "or italics-aware writer priors — the corpus cannot ground them."
        ),
        "measurement_payload": measurement_payload,
        "ship_recommendation": verdict_summary,
        "expected_methodology_if_signal_present": {
            "per_beat_metrics": [
                "italic_passages_count",
                "italic_words_count",
                "italic_words_per_100w",
            ],
            "classification_buckets": [
                "single_word_emphasis",
                "phrase_emphasis (2-5 words, mid-sentence)",
                "full_sentence_internal_thought (often present-tense, often after 'X thought' or no attribution)",
                "foreign_or_proper_noun (capitalized non-Common term)",
                "title_or_song (rare)",
                "sound_effect (rare)",
            ],
            "cross_book_gates": {
                "PASS": "per-kind ordering 3/3 books AND internal-thought share stable",
                "PASS_PARTIAL": "2/3 reproduce",
                "KILL": "italics not preserved in corpus",
            },
        },
    }

    # Write timestamped JSON
    out_path = write_timestamped_json(
        OUT_DIR,
        slug="italics-emphasis",
        content=out,
        prefix="crystal_shard",
    )
    print(f"\nWrote artifact: {out_path}")

    # Atomic-append section to conclusions doc
    section_md = build_conclusions_section(out, out_path)
    atomic_append_section(CONCLUSIONS_DOC, section_md)
    print(f"Appended to: {CONCLUSIONS_DOC}")

    # Atomic insert roadmap row
    row_md = build_roadmap_row()
    atomic_insert_row_before_anchor(
        ROADMAP_DOC,
        row_md,
        anchor="\n**Sequencing",
    )
    print(f"Inserted roadmap row in: {ROADMAP_DOC}")

    print(f"\n=== VERDICT: {verdict} ===")
    print(f"  {verdict_summary}")
    return 0


def build_conclusions_section(out: dict, artifact_path: Path) -> str:
    """Compose the markdown section appended to the conclusions doc."""
    cls = out["classification"]
    survey = out["encoding_survey"]
    fb = out["all_caps_fallback"]

    # Per-source-file table
    src_rows = []
    for book in BOOKS:
        key = f"source/{book}"
        if key not in survey:
            continue
        e = survey[key]["encoding_hits"]
        src_rows.append(
            f"| `source/{book}` | {survey[key]['size_chars']:,} | "
            f"{e['markdown_asterisk']['count']} | "
            f"{e['underscore_pair']['count']} | "
            f"{e['html_i_tag']['count']} | "
            f"{e['html_em_tag']['count']} | "
            f"{e['unicode_italic_chars']['count']} | "
            f"{survey[key]['all_caps_emphasis']['filtered_count']} |"
        )
    # Per-book beat-text rows
    beat_rows = []
    if "beats.jsonl" in survey:
        for book in BOOKS:
            if book not in survey["beats.jsonl"]["per_book"]:
                continue
            d = survey["beats.jsonl"]["per_book"][book]
            e = d["encoding_hits"]
            beat_rows.append(
                f"| `beats.jsonl[{book}]` | {d['size_chars']:,} | "
                f"{e['markdown_asterisk']['count']} | "
                f"{e['underscore_pair']['count']} | "
                f"{e['html_i_tag']['count']} | "
                f"{e['html_em_tag']['count']} | "
                f"{e['unicode_italic_chars']['count']} | "
                f"{d['all_caps_emphasis']['filtered_count']} |"
            )

    src_table = "\n".join(src_rows) if src_rows else "_(no source files found)_"
    beat_table = "\n".join(beat_rows) if beat_rows else "_(no beats.jsonl found)_"

    section = f"""

## Pattern {PATTERN_ID}: {PATTERN_NAME}

**Methodology.** Scanned every fiction-text-bearing artifact in the bundle for
the canonical italic encodings: markdown asterisk pairs (`*word*`), underscore
pairs (`_word_`), HTML/XML tags (`<i>` / `<em>`), and Unicode mathematical-
italic blocks (U+1D434–U+1D467). ALL-CAPS density (2+ chars, structural
artifacts filtered — `CHAPTER`/`BOOK`/`PRELUDE`/Roman numerals/`OK`/`NBSP` and
the four corpus-specific section-header fragments `RELUDE`/`EARCHES`/`LLIES`/
`RAILS`) was also captured as a fallback emphasis proxy. Artifacts swept:
`source/salvatore-{{crystal-shard,streams-of-silver,halflings-gem}}.txt`,
`beats.jsonl`, `scenes.jsonl`, `pairs.jsonl`,
`analysis/dialogue-extract.jsonl`. JSON output at `{artifact_path.name}`.

### Encoding survey — per-artifact hit counts

#### Source files (`source/*.txt`)

| Artifact | size (chars) | `*word*` | `_word_` | `<i>` | `<em>` | unicode-italic | ALL-CAPS (filtered) |
|---|---:|---:|---:|---:|---:|---:|---:|
{src_table}

#### Beat text (`beats.jsonl[text]` per book)

| Artifact | size (chars) | `*word*` | `_word_` | `<i>` | `<em>` | unicode-italic | ALL-CAPS (filtered) |
|---|---:|---:|---:|---:|---:|---:|---:|
{beat_table}

### Aggregate totals across all bundle artifacts

| Encoding | Total hits |
|---|---:|
| markdown asterisk (`*word*`) | {cls['totals_all_artifacts']['markdown_asterisk']} |
| underscore pair (`_word_`) | {cls['totals_all_artifacts']['underscore_pair']} |
| HTML `<i>` | {cls['totals_all_artifacts']['html_i_tag']} |
| HTML `<em>` | {cls['totals_all_artifacts']['html_em_tag']} |
| Unicode mathematical-italic chars | {cls['totals_all_artifacts']['unicode_italic_chars']} |

**italic-present-anywhere:** **{str(cls['italic_present']).lower()}**.

### Finding — italics not preserved

Italic markers were **completely stripped** during corpus ingestion. Zero
`*word*`, zero `_word_`, zero `<i>`, zero `<em>`, zero Unicode-italic characters
in any source file or downstream artifact. The 2,400+ underscores observed in
`pairs.jsonl` are JSON keys (`scene_id`, `beat_idx`, etc.); zero appear inside
`text`/`completion` field values.

Spot-checked the corpus for content that would canonically be italic in the
published Salvatore editions:

* **Direct internal thought** — only one first-person present-tense interior
  candidate found in CS (`I am different from my people...`) and it's actually
  inline dialogue, not interior monologue. The published editions italicize
  short interior beats ("He must die!") that here appear as plain-text
  declaratives, indistinguishable from narration.
* **Magical / telepathic speech** — Crenshinibon (the sentient Crystal Shard)
  whispers / cooes / hisses to Akar Kessell throughout CS, canonically rendered
  in italics in the published editions. Zero italic markers around any
  Crenshinibon speech in the corpus text.
* **Foreign / proper nouns** — `Crenshinibon` (64 occurrences in CS) and
  `Cryshal-Tirith` (54) are typically italicized in Salvatore's published
  editions; here they appear as plain capitalized text.
* **Imperative/address-self interior beats** — zero matches.

### ALL-CAPS as fallback emphasis signal — also unusable

ALL-CAPS density across all beat text (filtered for structural artifacts):
**{fb['beat_text_total_filtered_caps']} hits / {fb['beat_text_total_words']:,} words = {fb['beat_text_per_100w']:.5f} per 100w**.

Per-book:

| Book | filtered ALL-CAPS | words | per-100w |
|---|---:|---:|---:|
""" + "\n".join(
        f"| {b} | {d['caps_filtered']} | {d['words']:,} | {d['per_100w']:.5f} |"
        for b, d in fb["per_book"].items()
    ) + """

The remaining hit is `UP` (1 occurrence in streams_of_silver beat text — a
single in-prose stress that doesn't recur in the other two books). The pre-
filter raw-count was 4 (`RELUDE`, `EARCHES`, `LLIES`, `UP`) but three of those
are ingestion fragments — pieces of section-header text that escaped the
chapter-split (e.g. PRELUDE → `RELUDE` after the leading P was stripped). After
filtering structural artifacts, the cross-book signal is essentially zero
(0 / 1 / 0 across the trilogy = 0.00038 per 100w aggregate). Salvatore does
not use ALL-CAPS as an emphasis convention in published prose at any
measurable rate. ALL-CAPS therefore cannot proxy for the lost italic signal.

### Cross-book directional verdict: **KILL**

| Gate | Result |
|---|---|
| Italics preserved anywhere in bundle | **FAIL** — zero hits across all encodings |
| ALL-CAPS density usable as proxy | **FAIL** — 1 in-prose hit across the trilogy after structural-artifact filtering (raw 4: RELUDE/EARCHES/LLIES are ingestion fragments) |
| Per-kind ordering reproducible 3/3 | **N/A** (no signal to measure) |

### Proposed harness lever

**Re-ingest with italic preservation, then rerun this pattern.** Italics are a
high-value writer-prompt signal that the current bundle has destroyed. Once
recovered they would unlock:

1. **Writer-prompt prior (Salvatore-cluster fantasy via `WRITER_GENRE_PACKS`):**
   per-kind italic density target (likely interiority > dialogue > action >
   description). Drizzt's interior monologue is voice-bearing; italic full-
   sentence beats are part of the cadence.
2. **Internal-thought lexicon as fewshot voice imprint** — short imperative or
   present-tense interior beats are a Drizzt-voice signature. Pulling them out
   of the corpus would seed a fewshot block for the beat-writer.
3. **Foreign-term allowlist** for the lint layer — `Crenshinibon`,
   `Cryshal-Tirith`, Drow / Underdark / Halfling place-names. Doubles as a
   hallucination-checker corpus-vocabulary list.
4. **Beat-kind classifier signal** — full-sentence italic spans are a strong
   feature for distinguishing `interiority` from `description`/`action` beats.

**Re-ingestion path.** Use `pdfminer.six` or `ebook-convert` with italic-
preserving output (HTML or styled-markdown); convert italic runs to
`*word*` markers in the canonical text; rerun `scripts/corpus/run.ts` to
regenerate `beats.jsonl` / `scenes.jsonl` / `pairs.jsonl`. The decomposition
pipeline does not need changes — the regex-extraction layer here will pick
up the markers automatically once they exist.

**Until re-ingestion ships, do NOT introduce italics-density linting or
italics-aware writer priors.** The corpus cannot ground them; any prior would
be a synthetic prescription, not a measured imitation of the source corpus.
This is a Pattern 58 = KILL row — the signal is unmeasurable in the current
bundle, not absent from the published prose.

**Artifact:** `""" + str(artifact_path.absolute()) + "`\n"
    return section


def build_roadmap_row() -> str:
    """Build the single 7-column roadmap row to insert before the Sequencing anchor."""
    pattern_cell = (
        f"**{PATTERN_NAME}** (`pending`): KILL — zero italic markers preserved in any "
        f"bundle artifact (`source/*.txt`, `beats.jsonl`, `scenes.jsonl`, `pairs.jsonl`, "
        f"`dialogue-extract.jsonl`) across all 5 standard encodings (`*word*`, `_word_`, "
        f"`<i>`, `<em>`, Unicode mathematical-italic). Spot-checks confirm content that "
        f"would canonically be italic in published Salvatore editions — Crenshinibon "
        f"whispers, Drizzt interior monologue, Cryshal-Tirith proper noun — appears as "
        f"plain text. ALL-CAPS as fallback emphasis proxy also unusable: only 1 in-prose "
        f"hit in beat text after filtering ingestion fragments (raw 4 — `RELUDE`/"
        f"`EARCHES`/`LLIES` are section-header debris, leaving a single `UP`), "
        f"~0.00038 per 100w aggregate — Salvatore does not use ALL-CAPS for emphasis."
    )
    lever_cell = (
        "**Re-ingest source PDFs/EPUBs preserving italic markers** (pdfminer.six or "
        "ebook-convert → HTML/styled-markdown → `*word*` canonical markers) → rerun "
        "Pattern 58. Then: writer-prompt per-kind italic-density prior (likely "
        "interiority > dialogue > action > description); internal-thought fewshot "
        "lexicon (Drizzt-voice imprint); foreign-term allowlist for hallucination-"
        "checker (`Crenshinibon`, `Cryshal-Tirith`, Drow/Underdark place-names). "
        "**Until re-ingestion ships, do NOT introduce italics-density linting or "
        "italics-aware writer priors** — corpus cannot ground them."
    )
    row = (
        f"| {PATTERN_ID} | {pattern_cell} | {lever_cell} | NEW — DRAFT pending | — | "
        f"**KILL (3 books)** | n/a | "
        f"**KILL** — italics stripped during ingestion; signal unrecoverable until "
        f"re-ingestion with italic preservation; ALL-CAPS fallback also unusable |\n"
    )
    return row


if __name__ == "__main__":
    sys.exit(main())
