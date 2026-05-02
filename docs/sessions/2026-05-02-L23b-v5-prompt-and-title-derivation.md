---
loop: L23b
status: in-progress
started: 2026-05-02
branch: synthesis-bundle-v1
parent_loops: L22
experiment: TBD
---

# L23b — v5 Prompt: Lowercase Plural Role Exceptions + Character-Profile Derived Title Nouns

## Objective

L22 (exp #340, commit `865e134`) found 2 of 4 unresolved entities are outside the deterministic NER class space — they're prompt + grounded-surface gaps:

- **`senior auditors`** — lowercase plural generic role. v4 prompt has lowercase generic role+noun pass exception but plurals + this specific compound aren't matching. LLM v4 fires.
- **`Guildmaster`** — single-word capitalized title-only. World-bible likely contains "Guild" or "Sorcerers' Guild" but not the title itself. LLM fires because no surface match for the noun form.

Ship two fixes:
- **(a) v5 prompt iteration** — extend the v4 lowercase exception to explicitly include plural compound forms.
- **(b) character-profile title derivation** — derive title nouns from character `role` fields (e.g. "Guild Master" → "Guildmaster") and add to groundedSources.

## Acceptance Criteria

1. A/B shows v5 closes "senior auditors" FP without regressing v4 wins on labeled panel.
2. Title derivation surfaces "Guildmaster" as grounded when a character has role "Guild Master" or "Master".
3. Both fixes co-validated on L22 mini-fixture.
4. `bun test src/agents/halluc-ungrounded/` passes.
5. `bunx tsc --noEmit` clean.
6. `bun scripts/phase-eval/lint-prompts.ts` 0 errors.

## Design

### Fix (a): v5 prompt

Extend the v4 disambiguation block with a positive/additive sentence:
> "Plural lowercase compound role+noun phrases ('senior auditors', 'junior scribes', 'royal archivists') follow the same rule — they are job-class plural descriptors, not specific named entities."

Phrasing is additive to v4 — no NEVER/do not pattern (per `feedback_priming_suppression_ab`).

### Fix (b): character-profile title derivation

New helper `deriveTitleNouns(characters: CharacterProfile[]): string[]` in `context.ts`:
- For roles containing space-separated title patterns like "Guild Master", "Lord Sorcerer", "High Priest":
  - Emit joined-form: "GuildMaster" / "Guildmaster" (concatenation variants)
  - Emit individual title token if non-trivial (e.g. "Guildmaster" from "Guild Master")
- Safety: only emit when role actually contains a multi-word title. Don't blindly emit "Master" alone.
- Add `derived_titles` to `groundedSources` provenance and render `Derived-titles:` sub-line in WORLD BIBLE block.

## Files Changed

- `src/agents/halluc-ungrounded/halluc-ungrounded-system.md` — v4 → v5 (one sentence added)
- `src/agents/halluc-ungrounded/context.ts` — `deriveTitleNouns` helper + `derived_titles` in `buildContext`
- `src/agents/halluc-ungrounded/index.ts` — `buildNerGroundedSet` includes derived titles; `groundedSources` carries `derived_titles`
- `src/agents/halluc-ungrounded/context.test.ts` — tests for `deriveTitleNouns` and Derived-titles rendering
- `src/agents/halluc-ungrounded/index.test.ts` — tests for title-derived grounding + new-title still blocks
- `docs/halluc-v5-l23b-promotion-2026-05-02.md` — A/B + verdict doc
- `docs/decisions.md` — L23b entry

## Progress Log

| Time | Event |
|------|-------|
| 2026-05-02 start | Session context file written. Reading codebase. |

## Pickup Instructions

See `docs/halluc-v5-l23b-promotion-2026-05-02.md` for A/B results and verdict.
L23a (NER extractor extensions) dispatched in parallel — touches `src/lint/entity-candidates.ts` only.
