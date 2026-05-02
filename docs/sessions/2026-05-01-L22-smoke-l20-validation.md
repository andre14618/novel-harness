---
loop: L22
status: shipped
started: 2026-05-01
completed: 2026-05-02
branch: synthesis-bundle-v1
---

# L22 — LXC Smoke: Validate L20 character_roster + outline_entities Fix

## Objective

Deploy L20 (exp #339, commits `a505cb9` + `0dedd87` + `6172e68`) to LXC and validate via a fresh 3-chapter smoke that the Brennan/Aldric FP cluster is closed.

## Acceptance Criteria

1. 3/3 chapters draft cleanly OR documented blocker NOT in L20-fix class.
2. AND-gate firing rates queryable from `llm_calls.ner_prepass_json`.
3. Total cost < $4.
4. L17 entities don't trigger plan-assist.

## Result

**STOP CONDITION (b) — NEW cluster fires; L20-fix class fully closed.**

L17 acceptance criterion met (criteria 2, 3, 4). Did NOT achieve 3/3 chapters because a NEW small cluster blocked ch1.

| | L17 (PRE-L20) | L22 (POST-L20) |
|---|---|---|
| Plan-assist class | Brennan/Aldric/Sorcerer's Tower/Silver Street/Magistrate Dorn (10 entities) | T.C./Guildmaster/senior auditors/Aether waste (4 entities) |
| L17-class fires | YES | **NONE (closed by L20)** |
| Cost | $0.062 | $0.041 |
| AND-gate visible | NO | YES (FIRST production data) |

See `docs/l22-smoke-l20-validation-2026-05-01.md` for full telemetry, AND-gate matrix, NER class breakdown, and per-fire root-cause analysis.

## Progress Log

| Time | Event |
|------|-------|
| 2026-05-01 start | Pre-deploy checks passed. L21 untracked files present (not touching). LXC clear. |
| 2026-05-02 05:56 UTC | Deploy `6172e68` (L20). Sanity checks confirmed characterRoster + outlineEntities in deployed files. |
| 2026-05-02 05:57 UTC | Experiment #340 created. |
| 2026-05-02 05:59 UTC | Novel launched: novel-1777701435782. |
| 2026-05-02 06:10 UTC | Plan-assist gate fired on ch1 (4 NEW-class entities). |
| 2026-05-02 06:13 UTC | Telemetry pulled. L17 class confirmed closed. |
| 2026-05-02 06:14 UTC | Result doc + decisions + session doc written. Experiment 340 concluded. |

## Pickup Instructions

L22 closed. Follow-up sprint **L23** addresses the 4 NEW sub-classes:
1. NER initials extractor `[A-Z]\.[A-Z]\.` + grounding against character initials
2. Character-profile derived title nouns (Guildmaster from "Guild Master")
3. v5 prompt iteration for lowercase plural role exceptions ("senior auditors")
4. NER capitalized-first-only extractor + world-bible domain-term derivation ("Aether waste")

Each fix is small + orthogonal. Suggested as parallel-dispatch sprint similar to L14+L15+L16.

After L23 lands → re-smoke fantasy-debt to validate end-to-end completion.

L21 (EVENTS_SYSTEM v2, commits `58f159c`+`c353150`) was committed during L22's flight but NOT in the L22 deploy bundle. Will pick up on next deploy.
