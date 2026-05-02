---
loop: L22
status: shipped
created: 2026-05-01
experiment: 340
phase_eval_run: pending
---

# L22 — LXC Smoke Validating L20 Character-Roster + Outline-Entities Fix

## Summary

L20 (`a505cb9`+`0dedd87`+`6172e68`, exp #339) shipped a fix for L17's blocker: chapter-spanning character roster + outline-extracted entities are now in halluc-ungrounded `groundedSources`. L22 deployed L20 to LXC and ran a fresh 3-chapter `fantasy-debt` smoke.

**Headline:** **L20 fix WORKS.** The L17 blocker class is closed in production. Plan-assist did NOT fire on Brennan/Aldric/Sorcerer's Tower/Silver Street/Magistrate Dorn — these names appear in the production prose, are seen by NER (e.g. "Lord Brennan" extracted as title-pair), but are now grounded against the new `character_roster` + `outline_entities` buckets.

**Stop condition (b) triggered:** A NEW, smaller cluster (4 entities) blocked chapter 1 attempt 1. These are NOT in the L20-fix class — they are LLM-only-blocker fires on patterns the v4 prompt + NER prepass don't yet handle. Documented as the L23 follow-up.

## Acceptance Check

| Criterion | Result |
|-----------|--------|
| 3/3 chapters draft cleanly | ❌ ch1 only (plan-assist gate) |
| New cluster NOT in L20-fix class | ✅ confirmed (initials, single-word title, lowercase plural, capitalized-first-only domain term) |
| AND-gate firing rates queryable from `ner_prepass_json` | ✅ first production data |
| Total cost < $4 | ✅ $0.041 |
| L17 class entities don't trigger plan-assist | ✅ 0 fires on Brennan/Aldric/Sorcerer's Tower/Silver Street/Magistrate Dorn |

## Telemetry

**Run:** novel `novel-1777701435782`, deploy commit `6172e68`, fantasy-debt seed, log `/tmp/smoke-l22-fantasy-debt-1777701391.log`.

### Per-agent breakdown

| Agent | Calls | Cost |
|-------|-------|------|
| beat-writer | 32 | $0.0123 |
| planning-state-mapper | 3 | $0.0094 |
| halluc-ungrounded | 31 | $0.0047 |
| adherence-events | 31 | $0.0034 |
| planning-beats | 3 | $0.0027 |
| functional-state-checker | 1 | $0.0017 |
| chapter-plan-checker | 1 | $0.0015 |
| continuity-state | 1 | $0.0012 |
| continuity-facts | 1 | $0.0011 |
| world-builder | 1 | $0.0010 |
| planning-plotter | 1 | $0.0009 |
| character-agent | 1 | $0.0009 |
| plotter | 1 | $0.0002 |
| **TOTAL** | **88** | **$0.041** |

### AND-Gate Matrix (FIRST production measurement, enabled by L16)

| Decision | Count | % |
|----------|-------|---|
| pass | 9 | 29% |
| llm-only-blocker | 9 | 29% |
| ner-only-warning | 7 | 23% |
| ner+llm-blocker | 6 | 19% |
| **TOTAL** | **31** | |

### NER Classes Fired in Production

All 5 classes confirmed firing on real prose:
- `title-pair` (e.g. "Lord Brennan", "Master Vey", "Master Scribe")
- `capitalized-multi-word` (e.g. "Eastern Reach", "Crown Chancery", "Royal Scribe's Office")
- `suffix-class` (e.g. "Grand Vault", "Guild Council", "Eastern Reach")
- `x-of-y-capitalized` ("the Temple of Echoes") ← L15 extension validated
- `number-word-tail` ("Section Twelve", "Subclause Three") ← L15 extension validated

Many entities matched multiple classes (e.g. "Eastern Reach" → both capitalized-multi-word AND suffix-class). These are L20-grounded entities — they fire NER but are caught by the grounded-set lookup and don't block.

### Two-Stage Adherence

- adherence-events stage 1: 31 calls
- adherence-events-detailed stage 2: 0 calls

Stage 2 never fired because every adherence call returned `events_present=true`. The two-stage design is working as intended (no cost on pass cases).

### Plan-Assist Gate

```json
{
  "id": 58,
  "chapter": 1,
  "attempt": 1,
  "kind": "plan-check-exhausted",
  "unresolved_deviations": [
    {"beat_index": 1, "entity": "T.C.",  "context": "her own initials stamped in gold leaf: *T.C., Examiner*"},
    {"beat_index": 6, "entity": "Guildmaster", "context": "The Guildmaster's own seal at the bottom"},
    {"beat_index": 7, "entity": "senior auditors", "context": "He'd hand this to the senior auditors..."},
    {"beat_index": 8, "entity": "Aether waste", "context": "Every village the Aether waste takes"}
  ]
}
```

Gate fired on attempt 1. Same blockers persisted through all 3 retries (chapter exhausted at the gate).

## L23 — New Cluster Analysis

The 4 unresolved entities all fall outside L20's roster/outline buckets AND outside NER's existing class regexes:

1. **`T.C.`** — initials/abbreviation pattern (`[A-Z]\.[A-Z]\.`). NER's existing extractors require multi-word capitalized sequences; single-token initials with periods aren't picked up. The character is "Taryn Coombs" (or similar) and the initials are an in-prose self-reference.
   - **Fix candidate**: NER initials extractor `\b[A-Z]\.[A-Z]\.(?:[A-Z]\.)?` + match against character_roster initials.

2. **`Guildmaster`** — single-word capitalized title-only role. The world-bible likely contains "Sorcerers' Guild" but not the title itself. NER's title-pair requires `TITLE + Cap`. LLM v4 fires because no surface match.
   - **Fix candidate**: extend grounded surface to derive titles from character profiles (e.g. if a character's role is "Guild Master", add "Guildmaster" + "Guild Master" + "Master" variants); OR teach v5 prompt to treat single-word titles as descriptive when the institution is grounded.

3. **`senior auditors`** — lowercase generic plural. v4 prompt has a pass exception for lowercase generic role+noun (per L14), but plurals + the specific compound aren't matching. LLM is firing despite the v4 exception text.
   - **Fix candidate**: v5 prompt iteration explicitly listing plural generic role-classes; OR loosen the v4 lowercase rule to include `[lowercase] [lowercase]+s` patterns.

4. **`Aether waste`** — capitalized-first-only domain term (`[Cap] [lowercase]`). NER's capitalized-multi-word requires `[Cap] [Cap]+`. "Aether" is the magic system (likely in world-bible), so "Aether waste" is a derived domain term.
   - **Fix candidate**: NER capitalized-first-only extractor; OR derive "Aether [X]" combinations from the world-bible magic-system entry as grounded.

**Recommendation:** Each fix is small and orthogonal. Suggest a **L23 sprint** that ships all 4 in one bundle (extractor extensions for initials + capitalized-first-only; grounded-set derivations for title variants; v5 prompt for lowercase plural role exceptions). Then re-smoke to validate.

## Comparison vs L17

| | L17 (PRE-L20) | L22 (POST-L20) |
|---|---|---|
| Deploy commit | `2c46924` | `6172e68` |
| Chapters drafted | 1 (attempt 3 final) | 1 (attempt 1, plan-assist) |
| Plan-assist fire class | Brennan/Aldric/Sorcerer's Tower/Silver Street/Magistrate Dorn (10 entities) | T.C./Guildmaster/senior auditors/Aether waste (4 entities) |
| L17-class fires | YES (blocker) | NONE (closed by L20) |
| New class | (the L17 cluster itself) | initials + single-word title + lowercase plural + capitalized-first-only |
| Cost | $0.062 | $0.041 |
| AND-gate visible | NO (L16 not deployed) | YES (FIRST production measurement) |

## Conclusion + Action

**L20 ships its acceptance criterion.** The L17 character-roster + outline-entity grounding gap is closed. New blocker cluster is smaller (4 vs 10 entities), more diverse (4 root causes vs 1), and well-characterized.

**Action:** Open L23 sprint to address the 4 new sub-classes in parallel. Extractor extensions are deterministic + cheap; v5 prompt iteration follows the L14 pattern. After L23 lands, re-smoke fantasy-debt to validate end-to-end.

Convergence of evidence is now strong: each iteration narrows the blocker class. L11 → L17 → L22 sequence shows the harness is ratcheting toward 3/3-chapter completion via successive specific-class fixes.
