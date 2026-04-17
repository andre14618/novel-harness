"""Novel-bundle accessor — central loader for config.yml + path resolution.

Every pipeline script uses this to find a novel's files instead of hardcoding
paths. This is the single place per-novel paths are resolved.
"""

from __future__ import annotations
import yaml
from dataclasses import dataclass, field
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
NOVELS_DIR = REPO_ROOT / "novels"


@dataclass
class Character:
    name: str
    aliases: list[str]
    role: str = "supporting"
    archetype: str | None = None
    pov: bool = False
    books: list[str] = field(default_factory=list)
    full_name: str | None = None
    voice: str | None = None
    drives: str | None = None
    avoids: str | None = None
    conflict: str | None = None


@dataclass
class Bundle:
    """Self-contained accessor for a novel bundle."""
    key: str
    root: Path
    config: dict

    # Stage paths — stable across all pipeline scripts
    @property
    def canonical_txt(self) -> Path:
        return self.root / "canonical.txt"

    @property
    def scenes_jsonl(self) -> Path:
        return self.root / "scenes.jsonl"

    @property
    def scenes_report(self) -> Path:
        return self.root / "scenes.report.json"

    @property
    def beats_jsonl(self) -> Path:
        return self.root / "beats.jsonl"

    @property
    def beats_report(self) -> Path:
        return self.root / "beats.merge-report.json"

    @property
    def pairs_jsonl(self) -> Path:
        return self.root / "pairs.jsonl"

    @property
    def pairs_report(self) -> Path:
        return self.root / "pairs.merge-report.json"

    @property
    def verification_json(self) -> Path:
        return self.root / "verification.json"

    @property
    def pipeline_version_json(self) -> Path:
        return self.root / "pipeline_version.json"

    @property
    def analysis_dir(self) -> Path:
        d = self.root / "analysis"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def review_dir(self) -> Path:
        d = self.root / "review"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def reports_dir(self) -> Path:
        d = self.root / "reports"
        d.mkdir(parents=True, exist_ok=True)
        return d

    # Metadata accessors
    @property
    def title(self) -> str:
        return self.config.get("title", self.key)

    @property
    def author(self) -> str:
        return self.config.get("author", "unknown")

    @property
    def genre(self) -> str:
        return self.config.get("genre", "unknown")

    @property
    def books(self) -> list[str]:
        return self.config.get("books", [])

    @property
    def source_files(self) -> dict[str, Path]:
        """Map of book_key → absolute path to its source file."""
        sf = self.config.get("source_files", {})
        return {bk: (self.root / p).resolve() for bk, p in sf.items()}

    @property
    def characters(self) -> list[Character]:
        return [Character(**{k: v for k, v in c.items() if k in Character.__annotations__})
                for c in self.config.get("characters", [])]

    @property
    def character_aliases(self) -> dict[str, str]:
        """Flat map: every alias → canonical character name.
        Used by dialogue extraction and any attribution logic.
        """
        m = {}
        for c in self.characters:
            for alias in c.aliases:
                m[alias] = c.name
        return m

    @property
    def pov_characters(self) -> list[str]:
        return [c.name for c in self.characters if c.pov]

    @property
    def analyzers(self) -> list[str]:
        return self.config.get("analyzers", [])

    @property
    def review_gates(self) -> dict[str, bool]:
        return self.config.get("review_gates", {})

    def gate_enabled(self, gate_name: str) -> bool:
        return self.review_gates.get(gate_name, False)

    # ---- helpers for templated prompts (novel-agnostic extraction) ----

    def describe_for_prompt(self) -> str:
        """Short paragraph identifying this novel — injected into subagent prompts."""
        parts = [f"{self.author}'s {self.title}"]
        if self.config.get("year"):
            parts.append(f"({self.config['year']})")
        subgenre = self.config.get("subgenre")
        if subgenre:
            parts.append(f"— {subgenre}")
        return " ".join(parts)


def load_bundle(key_or_path: str) -> Bundle:
    """Load a bundle by key (resolves to novels/<key>/) or by full path."""
    path = Path(key_or_path)
    if path.is_dir():
        root = path
        key = path.name
    else:
        root = NOVELS_DIR / key_or_path
        key = key_or_path
    if not root.exists():
        raise FileNotFoundError(f"bundle not found: {root}")
    cfg_path = root / "config.yml"
    if not cfg_path.exists():
        raise FileNotFoundError(f"bundle missing config.yml: {cfg_path}")
    config = yaml.safe_load(cfg_path.read_text())
    return Bundle(key=key, root=root, config=config)


def list_bundles() -> list[str]:
    """Return keys of all bundles in novels/."""
    if not NOVELS_DIR.exists():
        return []
    return sorted(
        p.name for p in NOVELS_DIR.iterdir()
        if p.is_dir() and (p / "config.yml").exists()
    )
