---
status: in-progress
updated: 2026-05-01
role: overnight-loop-context
---

# L20 — Expand halluc-ungrounded groundedSources with character roster + named-location outputs

## Loop Contract

- **Objective:** Close the L17 FP cluster: established novel characters (Brennan, Aldric, Marwick, Dorn, Luken Ashby, Master Collector) and world locations (Sorcerer's Tower, Eastern Reach, Silver Street, Temple of Mercy) fire halluc-ungrounded because `groundedSources` only covers beat-scoped entities. Wire the full character roster + outline-derived named entities into the grounded surface.
- **Starting commit:** (HEAD at loop start)
- **Experiment ID:** TBD (created during loop)
- **Budget cap:** $1 (code + unit tests, no LLM calls)
- **Primary lever:** Add `character_roster` and `outline_entities` buckets to `groundedSources` in `src/agents/halluc-ungrounded/index.ts` and `context.ts`.
- **Files expected to change:**
  - `src/agents/halluc-ungrounded/context.ts` — add character roster + outline entity lines to WORLD BIBLE block
  - `src/agents/halluc-ungrounded/index.ts` — add new buckets to groundedSourcesObj + buildNerGroundedSet call
  - `src/agents/halluc-ungrounded/index.test.ts` — 4 new tests for L20 acceptance criteria
  - `docs/current-state.md` — update entity-grounding bullet
  - `docs/decisions.md` — append L20 entry
  - `docs/todo.md` — update §12 status note
- **Evidence artifact:** unit tests pass; tsc clean; mini-validation asserts L17 fire entities now grounded
- **Stop condition:** code lands + tests pass + tsc clean + commit posted + L17 mini-validation passes
- **Escalation condition:** data not available at check time (would require DB query from checker)

## Root Cause (from L17 recon)

- `getCharacters(novelId)` already fetches the full character roster and passes it as `characters: CharacterProfile[]` to `checkHallucUngrounded`. BUT the checker only uses this array to filter the SPEAKERS section (per-beat characters). The full name list is never added to the grounded surface.
- `worldBible.locations` IS in `groundedSources.bible` — but "Eastern Reach", "Silver Street", "Temple of Mercy" are not in the world bible `locations` array. They appear in planner-emitted text: beat `description` fields, outline `setting` text, and `establishedFacts[].fact` text.
- Fix: (1) add all `character.name` values from the `characters[]` param into the grounded surface; (2) run `extractProperNouns` over the full chapter outline text (setting + all beat descriptions + established facts) to capture planner-emitted entity names.

## Data Availability Confirmed

- Characters (Brennan, Aldric, etc.): in `characters` table, returned by `getCharacters()`, already passed into `checkHallucUngrounded`. No DB query needed — it's in-scope.
- World locations (Sorcerer's Tower): in `world_bibles.locations`, already in `worldBible` param.
- Planner-emitted locations (Eastern Reach, Silver Street, Temple of Mercy): in beat `description` fields and `outline.establishedFacts[].fact` text — extractable via `extractProperNouns` from the same `outline` param already in scope.

## Command Plan

1. Implement `buildOutlineEntityList(outline: ChapterOutline): string[]` — extract proper nouns from outline.setting, all beat descriptions, and established facts text.
2. Modify `buildContext` to add `Character-roster` and `Outline-entities` sub-lines to the WORLD BIBLE block.
3. Modify `checkHallucUngrounded` to add `character_roster` and `outline_entities` to `groundedSourcesObj` and pass them to `buildNerGroundedSet`.
4. Modify `buildNerGroundedSet` signature to accept the new buckets.
5. Write 4 new tests in `index.test.ts`.
6. Run `bun test src/agents/halluc-ungrounded/`.
7. Run `bunx tsc --noEmit`.
8. Mini-validation: unit tests directly assert L17 fire entities now pass.

## Progress Log

- [x] Session doc created
- [ ] DB experiment created
- [ ] Implementation in context.ts + index.ts
- [ ] Tests written and passing
- [ ] tsc clean
- [ ] docs updated
- [ ] commits posted

## Results

- Outcome: pending
- Evidence link/row/path: pending
- Cost: $0 (no LLM calls; DB experiment only)
- Commit(s): pending

## Pickup Instructions

- Last safe command: session doc created, no code changes yet
- If failed, failure fingerprint: tsc errors in context.ts or index.ts
- Next action: implement context.ts changes first, then index.ts
