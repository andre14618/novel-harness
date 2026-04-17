#!/usr/bin/env python3
"""Ingest a published novel (PDF or EPUB) into the canonical training-corpus text format.

Output format (single .txt file):
  - `=== Prelude ===` / `=== Epilogue ===` for unnumbered front/back sections
  - `=== BOOK N: Title ===` / `=== PART N TITLE ===` for major divisions
  - `CHAPTER N — Title` for numbered chapters
  - `* * *` for scene breaks (intra-chapter)
  - Paragraphs separated by blank lines

Usage:
  python3 scripts/finetune/ingest-corpus.py \\
    --input ~/Downloads/the_book.epub \\
    --output scripts/lora-data/the-book.txt \\
    [--start-marker "=== PART ONE ==="] [--end-marker "=== ACKNOWLEDGMENTS ==="]

Validates the output and prints per-section word counts + scene-break density. Refuse to
overwrite an existing output unless --force.

See docs/corpus-ingestion.md for the full procedure, per-source quirks, and downstream
chunking strategy used by the writer-imitation benchmark pipeline.
"""

import argparse
import io
import json
import re
import sys
from contextlib import redirect_stderr
from pathlib import Path


def extract_txt(path: Path) -> str:
    """Plain-text file already extracted from some prior tool. Just read it."""
    return path.read_text(encoding="utf-8", errors="replace")


def extract_pdf(path: Path) -> str:
    import pypdf
    from pdfminer.high_level import extract_text as pdfminer_extract

    reader = pypdf.PdfReader(str(path))
    pages = []
    for i, page in enumerate(reader.pages):
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        if not t.strip():
            with redirect_stderr(io.StringIO()):
                t = pdfminer_extract(str(path), page_numbers=[i]) or ""
        pages.append(t)
    return "\n".join(pages).replace("\x0c", "")


def normalize_pdf_structure(raw: str) -> str:
    """Heuristic markers for PDF-extracted text. Tested against Salvatore corpus."""
    text = raw

    # Scene breaks: lines of asterisks separated by spaces
    text = re.sub(r"\n\s*\*\s*\*\s*\*\s*\*?\s*\*?\s*\n", "\n\n* * *\n\n", text)

    # Prelude / Epilogue / Prologue: standalone word on its own line followed by
    # a capitalized sentence start. Strict variant first (sentence terminator
    # before) to avoid in-prose matches; then a permissive single-shot for
    # Prelude/Prologue at the very front of the document where there's no
    # preceding sentence (book opens with a title-page poem).
    text = re.sub(
        r'(?<=[\.!\?\"])\s*\n(Prelude|Epilogue|Prologue)\n(?=[A-Z])',
        r"\n\n=== \1 ===\n\n",
        text,
    )
    # Front-matter fallback for Prelude/Prologue: look only in the first 3000 chars
    head = text[:3000]
    rest = text[3000:]
    head = re.sub(
        r'\n(Prelude|Prologue)\n(?=[A-Z])',
        r"\n\n=== \1 ===\n\n",
        head,
        count=1,
    )
    text = head + rest

    # Book headers: "BOOK N:\nTitle\n" or "Book N:\nTitle\n" (case-insensitive)
    text = re.sub(
        r"\n(?:BOOK|Book) (\d+):\n([A-Z][\w \-']+)\n",
        r"\n\n=== BOOK \1: \2 ===\n\n",
        text,
    )

    # Chapter headers: number-on-line + title-on-line + content (caps OR quote)
    # Tolerates blank line between number and title; tolerates title preceding dialogue.
    text = re.sub(
        r"(?:^|\n)(\d{1,2})\n+([A-Z][A-Za-z \-',\.]+?)\n+(?=[A-Z\"'])",
        lambda m: f"\n\nCHAPTER {m.group(1)} — {m.group(2).strip()}\n\n",
        text,
        flags=re.MULTILINE,
    )

    return text


EPUB_SKIP_LOG: list[dict] = []  # populated during extraction; surfaced in report

def extract_epub(path: Path) -> str:
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup

    book = epub.read_epub(str(path))
    docs = list(book.get_items_of_type(ebooklib.ITEM_DOCUMENT))

    # Common front/back-matter doc names to skip. Each skip is logged so
    # the report surfaces what was dropped and why.
    skip_substrings = {
        "nav", "drm_notice", "cover", "title", "endpaper",
        "copyright", "about_author", "about_publisher", "dedication",
        "acknowledgements", "acknowledgments", "toc", "epigraph",
        "newsletter", "ad.xhtml", "contents", "frontmatter", "backmatter",
    }

    out = []
    EPUB_SKIP_LOG.clear()
    for d in docs:
        name = d.get_name().split("/")[-1].lower()
        matched = [s for s in skip_substrings if s in name]
        if matched:
            EPUB_SKIP_LOG.append({"doc": d.get_name(), "matched_substrings": matched})
            continue
        soup = BeautifulSoup(d.get_content(), "html.parser")
        for tag in soup(["script", "style"]):
            tag.decompose()

        parts = []
        for el in soup.find_all(["h1", "h2", "h3", "h4", "p", "hr", "div"]):
            cls = " ".join(el.get("class", []))
            if el.name == "hr":
                # <hr> is almost always a scene-break separator in EPUBs
                parts.append("\n\n* * *\n\n")
                continue
            if el.name in ("h1", "h2", "h3", "h4"):
                txt = el.get_text(" ", strip=True)
                if txt:
                    parts.append(f"\n\n=== {txt} ===\n\n")
            elif el.name == "p":
                txt = el.get_text(" ", strip=True)
                # Common scene-break class names from various publishers
                if any(k in cls.split() for k in ("secbreak", "scenebreak", "sb", "ornament", "asterisk")):
                    parts.append("\n\n* * *\n\n")
                    continue
                if not txt:
                    continue
                # Asterisk-only paragraphs
                if re.match(r"^[\*\s\u2022\u2767\u2042\u2731]+$", txt):
                    parts.append("\n\n* * *\n\n")
                else:
                    parts.append(txt + "\n\n")
            elif el.name == "div":
                # Some EPUBs use <div class="break"> for scene breaks
                if any(k in cls.split() for k in ("secbreak", "scenebreak", "break", "ornament")):
                    if not el.find(["p", "h1", "h2", "h3", "h4"]):
                        parts.append("\n\n* * *\n\n")
        if parts:
            out.append("".join(parts))

    return re.sub(r"\n{4,}", "\n\n\n", "".join(out))


def trim_to_markers(text: str, start: str | None, end: str | None) -> str:
    if start:
        m = re.search(re.escape(start), text)
        if m:
            text = text[m.start():]
        else:
            print(f"WARN: start marker {start!r} not found", file=sys.stderr)
    if end:
        m = re.search(re.escape(end), text)
        if m:
            text = text[: m.start()]
        else:
            print(f"WARN: end marker {end!r} not found", file=sys.stderr)
    return text.strip() + "\n"


def report(text: str) -> dict:
    pattern = re.compile(r"(?:CHAPTER \d+[^\n]*|=== [^=]+ ===)")
    matches = list(pattern.finditer(text))
    sections = []
    for i, m in enumerate(matches):
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[body_start:body_end]
        wc = len(body.split())
        sb = body.count("* * *")
        sections.append({"title": m.group(), "words": wc, "scenes": sb + 1 if wc > 100 else 0})
    return {
        "chars": len(text),
        "words": len(text.split()),
        "section_markers": len(matches),
        "scene_breaks": text.count("* * *"),
        "sections": sections,
        "epub_docs_skipped": list(EPUB_SKIP_LOG),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path, help="Source .pdf or .epub")
    ap.add_argument("--output", required=True, type=Path, help="Destination .txt path")
    ap.add_argument("--start-marker", help="Trim everything before this exact string")
    ap.add_argument("--end-marker", help="Trim everything from this exact string onward")
    ap.add_argument("--force", action="store_true", help="Overwrite existing output")
    ap.add_argument("--json", action="store_true", help="Also write <output>.report.json with stats")
    args = ap.parse_args()

    if args.output.exists() and not args.force:
        sys.exit(f"refusing to overwrite {args.output} — pass --force")

    src = args.input.expanduser().resolve()
    ext = src.suffix.lower()
    if ext == ".pdf":
        raw = extract_pdf(src)
        text = normalize_pdf_structure(raw)
    elif ext == ".epub":
        text = extract_epub(src)
        # Some publisher EPUBs (esp. Calibre-converted) put chapter headings
        # as plain "N\nTitle\n" inside chapter prose rather than as <h1>-<h4>.
        # Re-normalize so those patterns get caught too.
        text = normalize_pdf_structure(text)
    elif ext == ".txt":
        # Already-extracted text — apply the same heuristic markers used for PDFs.
        raw = extract_txt(src)
        text = normalize_pdf_structure(raw)
    else:
        sys.exit(f"unsupported format {ext!r} (expected .pdf, .epub, or .txt)")

    text = trim_to_markers(text, args.start_marker, args.end_marker)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text)

    rep = report(text)
    print(f"\n=== {src.name} → {args.output} ===")
    print(f"  {rep['chars']:,} chars / {rep['words']:,} words")
    print(f"  {rep['section_markers']} section markers / {rep['scene_breaks']} scene breaks\n")
    for s in rep["sections"]:
        title = s["title"][:50]
        print(f"  {title:50s} {s['words']:>6}w  {s['scenes']} scenes")

    # Validation gates
    issues = []
    if rep["words"] < 50_000:
        issues.append(f"word count {rep['words']:,} suspiciously low for a novel")
    if rep["section_markers"] < 5:
        issues.append(f"only {rep['section_markers']} section markers — chapter detection likely failed")
    if rep["scene_breaks"] == 0:
        issues.append("no scene breaks detected — verify source uses <hr>, secbreak class, or *** lines")
    if issues:
        print("\nVALIDATION WARNINGS:", file=sys.stderr)
        for i in issues:
            print(f"  - {i}", file=sys.stderr)

    if args.json:
        report_path = args.output.with_suffix(".report.json")
        report_path.write_text(json.dumps(rep, indent=2))
        print(f"\nstats: {report_path}")


if __name__ == "__main__":
    main()
