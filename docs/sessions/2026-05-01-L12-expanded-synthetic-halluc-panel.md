---
status: in-progress
updated: 2026-05-01
duration: ~1h
commits: 3
subagents_spawned: 0

# ── Workflow telemetry ─────────────────────────────────────────────────────
wall_clock_min: 0
codex_reviews: 0
rework_passes: 0
bugs_caught_by_codex: 0
bugs_caught_by_preflight: 0
bugs_escaped_to_prod: 0
preflight_false_positives: 0
---

# L12: Expanded Synthetic Hallucination Panel — Per-class Matrix — 2026-05-01

## Context

This session is an unattended panel-expansion loop. The goal is to expand synthetic
hallucination fixtures beyond the single-class (Veyr Dominion / named place) fixture
from exp #302, add per-class FAIL + PASS controls, run the v3 checker (with NER prepass)
on the expanded panel, and persist a per-class recall/precision matrix.

**Parent experiments:** exp #302 (original synthetic panel, 0% halluc recall), exp #325 (L9 allowedNewEntities).

## Loop Contract

- **Acceptance:** 6+ FAIL classes × 2-3 fixtures each + 4+ PASS controls land as a panel JSONL; the v3+NER checker is run; per-class matrix persisted; result doc and decisions.md entry land.
- **Budget cap:** $2.
- **DO NOT DEPLOY** (L11 running in parallel).
- **DO NOT modify runtime files** (`src/agents/halluc-ungrounded/`). Panel + script + docs only.

## Classes Seeded

1. `title-surname` — FAIL: Master Orin / Mistress Ilara / Captain Kessrin; PASS: Master Vael (grounded title+name)
2. `named-institution` — FAIL: Office of Structural Integrity / Bureau of Civic Truth / Council of Forty-Seven Tongues; PASS: Council of Sigils (grounded)
3. `named-place-realm` — FAIL: Vale of Whispers / Crown of Hyran / the Suncrest Reach; PASS: the Greenmarch (grounded)
4. `named-artifact` — FAIL: the Riverstone Chord / the Iron Veyl / the Sigil of Eight; PASS: the Master Ledger (grounded)
5. `named-historical-event` — FAIL: the Three Days' War / the Quiet Reckoning / the Year of Fallen Axes; PASS: the Great Auditing (grounded)
6. `plural-faction` — FAIL: the Bellward Order / the Quiet Concord / the Veiled Eight; PASS: the Auditors (grounded)
7. `generic-document-fp-control` (PASS only) — "the reconciliation report" / "the porter's testimony" / "the master archivist" — must NOT fire in either v3 or NER

## Key Files

- Panel: `scripts/hallucination/expanded-fail-classes-panel.jsonl`
- Run script: `scripts/hallucination/run-expanded-class-panel.ts`
- Results: `scripts/hallucination/expanded-class-panel-results.<TIMESTAMP>.jsonl`
- Result doc: `docs/expanded-synthetic-halluc-panel-2026-05-01.md`
- Experiment: tracked in `tuning_experiments`; persisted to `phase_eval_runs`

## Prior Findings (Context)

- exp #302: Original 5-row Veyr Dominion panel showed **0% recall** on the halluc checker.
  v3+NER (exp #322) was introduced later; this loop tests whether the NER prepass improves per-class recall.
- The generic-document FP cluster ("the reconciliation report", "porter's testimony") was flagged as
  a known FP in exp #304. Must-not-fire is the acceptance bar for those rows.

## Status

[ ] Panel built
[ ] Run script built
[ ] Experiment created
[ ] Panel run completed
[ ] Matrix persisted
[ ] Result doc written
[ ] decisions.md appended
[ ] todo.md updated
[ ] Committed
