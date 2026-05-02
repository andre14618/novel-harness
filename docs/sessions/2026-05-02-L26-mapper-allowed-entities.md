---
status: shipped
updated: 2026-05-02
loop: L26
---

# L26 — Verify mapper emits allowedNewEntities correctly

## Loop Contract

- Objective: Verify that the planning-state-mapper emits `allowedNewEntities` only when a new named entity is sanctioned, that legitimate walk-ons/props/locations ARE included, and that existing beat characters are NOT duplicated.
- Starting commit: 125e848
- Experiment ID: 348
- Budget cap: $1.50 total ($0.50/seed)
- Primary question: Is `allowedNewEntities` functioning correctly in production — actively used, qualitatively sound, and free of duplication FPs?
- Files/scripts created:
  - `scripts/phase-eval/probe-mapper-allowed-entities.ts` (full probe — runs concept+planning+analysis)
  - `scripts/phase-eval/analyze-mapper-allowed-entities.ts` (analysis-only — loads existing outlines)
  - `output/phase-eval/L26-mapper-allowed-entities/` (outputs — gitignored)
- Evidence artifact: `output/phase-eval/L26-mapper-allowed-entities/summary-*.json`, `verdict-*.txt`
- Stop condition: phase_eval_runs row written + experiment concluded + docs updated + commits posted
- Escalation condition: dup FP rate > 0 → document and propose L32 mapper-fix loop (renamed from L27 to avoid collision with shipped L27 DB-test reachability sweep — exp #347)

## Baseline

- `allowedNewEntities` has been wired into the halluc-ungrounded grounded surface since commits `5054fd4`+`f019c60` (L9, exp #325).
- L11 (exp #326) confirmed the pipeline wiring is correct: `groundedSources.allowed_new_entities` bucket appears in `request_json` for all halluc-ungrounded calls.
- BUT L11 noted: "the fantasy-debt seed emitted no `allowedNewEntities` in this run (planner did not sanction new entities), so the bucket is correctly empty — the pipeline wiring is verified, not the FP suppression behavior."
- Todo §7 item: "Teach/verify the mapper emits `allowedNewEntities` only when a new named entity is sanctioned."

## Pre-Loop Recon

The mapper prompt (`state-mapper-system.md`, Placement Guidance section) says:
> "Use `allowedNewEntities` only for new named people, places, institutions, artifacts, or lore terms the writer may introduce in that beat."

The mapper receives `targetChapter.charactersPresent` and `scenes[*].characters` in its context — it should be able to distinguish established from new characters. The question is whether it does.

## Command Plan

1. Create experiment in DB (exp #348)
2. Write probe script + analysis-only script
3. Run probe on 3 seeds × 3 chapters each: fantasy-debt, fantasy-system-heretic, fantasy-inscription
4. Collect outlines.json from disk, run analysis
5. Persist phase_eval_runs row (id=120)
6. Conclude experiment, update docs, commit

## Results

**Verdict: FAIL-DUP-FPS**

| Seed | Beats | Non-empty | Rate | Entities | BeatDupFPs | ChDupFPs |
|---|---|---|---|---|---|---|
| fantasy-debt | 45 | 1 | 2% | 1 | 0 | 0 |
| fantasy-system-heretic | 58 | 3 | 5% | 3 | 0 | 0 |
| fantasy-inscription | 45 | 2 | 4% | 3 | 2 | 1 |
| **Total** | **148** | **6** | **4.1%** | **7** | **2** | **1** |

**All 7 entities (qualitative):**
- `collective crown debt` (fantasy-debt ch3b8) — plausible prop/abstract
- `record hall warding` (fantasy-system-heretic ch2b7) — plausible location
- `Arbiter's Spire holding cell` (fantasy-system-heretic ch2b20) — plausible location
- `Free Scribe` (fantasy-system-heretic ch3b13) — plausible walk-on
- `Sera` (fantasy-inscription ch3b1) — suspicious proper noun; also in beat.characters → **DUP FP**
- `Master Inquisitor Orvath` (fantasy-inscription ch3b10) — named story character in `charactersPresent` AND `beat.characters` → **DUP FP + CH DUP**
- `inquisitors` (fantasy-inscription ch3b10) — plausible walk-on (generic plural)

**Root cause of dup FPs:**
fantasy-inscription ch3 beat 1: `Sera` appears as a new character introduced in that beat, so the mapper listed her in both `beat.characters` (via planning-beats expansion) AND `allowedNewEntities` (via mapper). This is a coordination failure — the beat expansion already added her as a beat character; the mapper sees her in the beat description and re-sanctions her.

fantasy-inscription ch3 beat 10: `Master Inquisitor Orvath` is a named main story character (in `charactersPresent`), yet the mapper emitted him in `allowedNewEntities`. This is a clear error — the mapper was told "Characters present: Calla Vren, Davan, Master Inquisitor Orvath" but still listed Orvath as a new entity.

**Non-empty rate analysis:**
4.1% is very sparse but probably appropriate — most beats don't introduce genuinely-new entities. The issue is not under-emission on legitimate walk-ons (the 5 non-FP entities are all qualitatively correct), but the 2 FP cases where the mapper re-sanctioned already-established entities.

**Cost:** $0.035 (planner-only: $0.024 mapper + $0.008 beats + $0.003 plotter). Well under $1.50 cap.

## Progress Log

- [2026-05-02] L26 started. Read all source files. Wrote probe script + analysis script. Created experiment #348.
- [2026-05-02] Probe ran: 3 seeds × 3 chapters, ~8 min. FAIL-DUP-FPS with 2 beat-level dup FPs (fantasy-inscription ch3). Persisted phase_eval_runs.id=120. Concluded experiment #348.
- [2026-05-02] Wrote session doc, result doc, updated decisions.md + todo.md. Committing.

## Pickup Instructions

- Last safe command: all committed
- If failed, failure fingerprint: n/a
- Next action: L32 — fix mapper prompt to exclude already-established characters from `allowedNewEntities`. Fix: add explicit rule to the Placement Guidance section: "Do NOT include characters that are already in `charactersPresent` or already listed in the current beat's character list in `allowedNewEntities`." (Renamed from L27 to avoid collision with shipped L27 DB-test reachability sweep — exp #347.)
