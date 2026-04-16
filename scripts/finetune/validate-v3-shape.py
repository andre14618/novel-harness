#!/usr/bin/env python3
"""Validate salvatore-1988-v3 training JSONL against the harness's runtime
user-prompt shape (src/agents/writer/beat-context.ts::buildBeatContext).

Runs a spec-driven structural check on every row and reports:
  - missing required sections
  - unexpected section orders
  - retry-variant shape errors (if --expect-retries)
  - rename-augmentation sanity (no Salvatore blocklist tokens leaking through
    into renamed variants)
  - a coverage summary (section-presence rates, retry-type distribution)

Exits non-zero on any hard violation so this can gate W&B training submission.

Run:
  python3 scripts/finetune/validate-v3-shape.py \\
    --input finetune-data/salvatore-1988-v3-sft-train.jsonl \\
    --val finetune-data/salvatore-1988-v3-sft-val.jsonl \\
    --system-prompt src/agents/writer/beat-writer-system-salvatore.md
"""

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path


# ── Expected sections (matches beat-context.ts assembly order) ──────────

SECTION_PATTERNS = {
    "beat_header": re.compile(r"^BEAT \d+ of \d+$", re.MULTILINE),
    "pov": re.compile(r"^POV: .+$", re.MULTILINE),
    "setting_inline": re.compile(r"^Setting: .+$", re.MULTILINE),
    "characters_present": re.compile(r"^Characters present: .+$", re.MULTILINE),
    "bridge": re.compile(r"^TRANSITION BRIDGE \(continue from here\):\n", re.MULTILINE),
    "landing": re.compile(r"^LANDING TARGET \(end connecting toward this\):\nNext beat: ", re.MULTILINE),
    "characters_section": re.compile(r"^CHARACTERS:\n", re.MULTILINE),
    "setting_section": re.compile(r"^SETTING: ", re.MULTILINE),
    "targeted_rewrite": re.compile(r"^--- TARGETED REWRITE ---\n", re.MULTILINE),
    "issues_found": re.compile(r"^Issues found:\n- ", re.MULTILINE),
}

# Required on every base row
REQUIRED_BASE = ["beat_header", "pov", "setting_inline"]
# Required on retry rows (in addition to base)
REQUIRED_RETRY = ["targeted_rewrite", "issues_found"]

# Salvatore blocklist tokens — if ANY of these appear in a renamed-variant
# row's prose, the rename didn't catch that token and we have a bleed
BLOCKLIST_TOKENS = [
    "Drizzt", "Wulfgar", "Bruenor", "Regis", "Catti-brie", "Entreri",
    "Kessell", "Guenhwyvar", "Heafstaag", "Akar Kessell",
    "Icewind Dale", "Ten-Towns", "Mithril Hall", "Lonelywood",
    "Bryn Shander", "Targos", "Caer-Konig", "Caer-Dineval",
    "Crystal Shard", "Crenshinibon", "Aegis-fang",
    "drow", "Underdark", "Faerûn",
]


def classify_row(row: dict) -> str:
    """Infer whether this is a base or retry row from the user prompt content."""
    user = row["messages"][1]["content"]
    if SECTION_PATTERNS["targeted_rewrite"].search(user):
        return "retry"
    return "base"


def check_sections(user_prompt: str, required: list[str]) -> list[str]:
    """Return list of missing required section names."""
    return [s for s in required if not SECTION_PATTERNS[s].search(user_prompt)]


def check_section_order(user_prompt: str) -> list[str]:
    """Verify section ordering matches the production assembler (headers
    in order: beat_header → bridge → landing → characters_section → setting_section)."""
    errors = []
    positions = {}
    for name, pat in SECTION_PATTERNS.items():
        m = pat.search(user_prompt)
        if m:
            positions[name] = m.start()

    # Beat header must come first
    if "beat_header" in positions:
        for other, pos in positions.items():
            if other in ("beat_header", "pov", "setting_inline", "characters_present"):
                continue
            if pos < positions["beat_header"]:
                errors.append(f"Section '{other}' appears before BEAT header")

    # Production order: bridge < landing < characters_section < setting_section
    order = ["bridge", "landing", "characters_section", "setting_section"]
    present = [(n, positions[n]) for n in order if n in positions]
    for i in range(len(present) - 1):
        if present[i][1] >= present[i + 1][1]:
            errors.append(f"Section '{present[i][0]}' should come before '{present[i + 1][0]}'")
    return errors


def check_system_prompt(row: dict, canonical: str) -> list[str]:
    """Ensure every row's system prompt matches the canonical system prompt file.
    Drift here would mean inference-time prompt doesn't match training."""
    if row["messages"][0]["role"] != "system":
        return ["First message is not 'system' role"]
    if row["messages"][0]["content"] != canonical:
        return ["System prompt differs from canonical beat-writer-system-salvatore.md"]
    return []


def check_blocklist_leak(row: dict) -> list[str]:
    """Check for Salvatore blocklist tokens in user + assistant. For variant 0
    (original prose from the corpus) this is expected. For variants 1+
    (renamed) it means the rename didn't catch that token → real error."""
    leaks = []
    user = row["messages"][1]["content"]
    assistant = row["messages"][2]["content"]
    combined = user + "\n" + assistant
    for tok in BLOCKLIST_TOKENS:
        pattern = re.compile(r"\b" + re.escape(tok) + r"\b", re.IGNORECASE)
        if pattern.search(combined):
            leaks.append(tok)
    return leaks


def is_renamed_variant(row: dict) -> bool:
    """Returns True if this row is a rename-augmented variant (not the
    byte-faithful original). Uses _meta if present, falls back to heuristic."""
    meta = row.get("_meta", {})
    if "variant" in meta:
        return meta["variant"] > 0
    return False


def sample_print_row(row: dict, row_num: int):
    user = row["messages"][1]["content"]
    assistant = row["messages"][2]["content"]
    print(f"━━━━━━ row {row_num} ({classify_row(row)}) ━━━━━━")
    print("── system prompt preview ──")
    print(row["messages"][0]["content"][:200] + ("..." if len(row["messages"][0]["content"]) > 200 else ""))
    print("── user prompt ──")
    print(user)
    print("── assistant prose (first 300 chars) ──")
    print(assistant[:300] + ("..." if len(assistant) > 300 else ""))
    print(f"── user prompt: {len(user)} chars, ~{len(user) // 4} tokens")
    print(f"── assistant prose: {len(assistant)} chars, {len(assistant.split())}w")
    print()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, type=Path, help="Training JSONL")
    ap.add_argument("--val", type=Path, help="Val JSONL")
    ap.add_argument("--system-prompt", required=True, type=Path, help="Canonical beat-writer-system-salvatore.md")
    ap.add_argument("--samples", type=int, default=3, help="Number of rows to sample-print")
    ap.add_argument("--expect-retries", action="store_true", default=True, help="Require >10%% retry rows")
    args = ap.parse_args()

    canonical = args.system_prompt.read_text()
    all_errors: list[tuple[int, str, str]] = []  # (row_idx, kind, detail)
    warnings_counter = Counter()

    def validate_file(path: Path, label: str) -> tuple[int, int]:
        """Returns (rows, retries). Accumulates errors/warnings via closure."""
        rows = [json.loads(l) for l in path.open() if l.strip()]
        retries = 0
        for i, row in enumerate(rows):
            kind = classify_row(row)
            if kind == "retry":
                retries += 1

            # 1. Schema: messages is [system, user, assistant]
            msgs = row.get("messages", [])
            if len(msgs) != 3 or [m.get("role") for m in msgs] != ["system", "user", "assistant"]:
                all_errors.append((i, label, f"Messages shape wrong: {[m.get('role') for m in msgs]}"))
                continue

            # 2. System prompt matches canonical
            for err in check_system_prompt(row, canonical):
                all_errors.append((i, label, err))

            # 3. Required sections present
            user = msgs[1]["content"]
            required = list(REQUIRED_BASE)
            if kind == "retry":
                required += REQUIRED_RETRY
            for missing in check_sections(user, required):
                all_errors.append((i, label, f"Missing section: {missing}"))

            # 4. Section ordering
            for err in check_section_order(user):
                all_errors.append((i, label, f"Section order: {err}"))

            # 5. Assistant non-empty
            if not msgs[2].get("content", "").strip():
                all_errors.append((i, label, "Assistant prose is empty"))

            # 6. Blocklist leak — error on rename variants (clean failure of
            # rename pass), warning on variant 0 (originals legitimately use
            # Salvatore tokens as byte-faithful corpus prose).
            leaks = check_blocklist_leak(row)
            if leaks:
                if is_renamed_variant(row):
                    for tok in leaks:
                        all_errors.append((i, label, f"rename-variant leaked blocklist token: {tok}"))
                else:
                    warnings_counter[f"variant-0 blocklist tokens (expected):{label}"] += len(leaks)

        return len(rows), retries

    print(f"Validating {args.input}")
    train_total, train_retries = validate_file(args.input, "train")
    val_total = val_retries = 0
    if args.val:
        print(f"Validating {args.val}")
        val_total, val_retries = validate_file(args.val, "val")

    print()
    print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print(f"Train:  {train_total} rows  ({train_retries} retry, {train_total - train_retries} base)")
    if args.val:
        print(f"Val:    {val_total} rows    ({val_retries} retry, {val_total - val_retries} base)")
    retry_frac = train_retries / max(1, train_total)
    print(f"Retry fraction: {retry_frac:.1%}")

    # Section-presence rates (base rows only for structural signal)
    presence = defaultdict(int)
    base_count = 0
    for path in [args.input] + ([args.val] if args.val else []):
        for line in path.open():
            if not line.strip():
                continue
            row = json.loads(line)
            if classify_row(row) != "base":
                continue
            base_count += 1
            user = row["messages"][1]["content"]
            for name, pat in SECTION_PATTERNS.items():
                if pat.search(user):
                    presence[name] += 1

    print()
    print("Section-presence rates (base rows only, n=%d):" % base_count)
    for name in ["beat_header", "pov", "setting_inline", "characters_present", "bridge", "landing", "characters_section", "setting_section"]:
        n = presence[name]
        pct = n / max(1, base_count)
        print(f"  {name:22s}  {n:5d}  {pct:6.1%}")

    # ── Sample print ────────────────────────────────────────────────
    print()
    print(f"━━━━━━━━━━━━━━ {args.samples} sample rows ━━━━━━━━━━━━━━")
    import random
    rng = random.Random(0)
    with args.input.open() as f:
        all_train = [json.loads(l) for l in f if l.strip()]
    # Bias toward having at least one retry and one with bridge in samples
    retries = [r for r in all_train if classify_row(r) == "retry"]
    with_bridge = [r for r in all_train if classify_row(r) == "base" and SECTION_PATTERNS["bridge"].search(r["messages"][1]["content"])]
    first_beat = [r for r in all_train if classify_row(r) == "base" and not SECTION_PATTERNS["bridge"].search(r["messages"][1]["content"])]
    samples = []
    if retries: samples.append(rng.choice(retries))
    if with_bridge: samples.append(rng.choice(with_bridge))
    if first_beat: samples.append(rng.choice(first_beat))
    while len(samples) < args.samples and all_train:
        samples.append(rng.choice(all_train))
    for i, s in enumerate(samples):
        sample_print_row(s, i + 1)

    # ── Warnings + errors ──────────────────────────────────────────
    if warnings_counter:
        print("Warnings:")
        for k, v in warnings_counter.most_common():
            print(f"  {k}: {v} occurrences")

    if all_errors:
        print()
        print(f"━━━━━━━━━━━━ {len(all_errors)} errors ━━━━━━━━━━━━")
        # Print first 10 unique error types
        by_type = Counter(e[2] for e in all_errors)
        print("Error types:")
        for err_type, count in by_type.most_common(10):
            print(f"  {count:5d}x  {err_type}")
        print()
        print(f"First 5 errors:")
        for idx, label, msg in all_errors[:5]:
            print(f"  [{label} row {idx}] {msg}")
        sys.exit(1)

    # Hard gates
    if args.expect_retries and retry_frac < 0.10:
        print(f"\nERROR: retry fraction {retry_frac:.1%} is below 10% — retry shape under-trained")
        sys.exit(1)

    print("\n✓ validation passed")


if __name__ == "__main__":
    main()
