---
status: frozen-2026-04-18
---

# `salvatore-distinctness-v1`

## Purpose

`salvatore-distinctness-v1` answers one decision: does runtime conditioning rotation on top of `salvatore-1988-v4` materially improve multi-character voice separation enough that corpus expansion can wait? The score is a ship/iterate gate for the conditioning-first Salvatore rewrite: ship the conditioning floor if rotated voice cards add enough exact assignments over fixed v4, iterate if the gain is real but incomplete, and reopen corpus expansion only if the rotation floor stays too weak.

## Cells

- **24 assignment cells total** = `6 characters × 4 beat archetypes`
- Characters: `Drizzt`, `Bruenor`, `Catti-brie`, `Entreri`, `Jarlaxle`, `Zaknafein`
- Fixed hard pairs, repeated on all 4 beats:
  - `Drizzt ↔ Entreri`
  - `Bruenor ↔ Catti-brie`
  - `Jarlaxle ↔ Zaknafein`
- Per beat, the judge sees 3 anonymized pairwise matchups.
- Across 4 beats, that yields `12 pairwise judgments`.
- Each judgment yields `2 assignment cells`, so the topline is `24`.

## Beat Prompt Pool

Frozen beat archetypes:

1. `threat`
   Prompt template: `A dangerous raider holds a hostage and assumes your side will back down. Speak in the moment before violence, making clear what happens next if the hostage is harmed.`
2. `reassurance`
   Prompt template: `A shaken companion blames themselves for a failed rescue that left the group scattered. Steady them enough to keep moving, but do not pretend the danger is over.`
3. `tactical_planning`
   Prompt template: `Your group has one night to cross guarded ground, recover a captive, and leave before reinforcements close in. Lay out the plan in practical terms while making your priorities and assumptions clear.`
4. `banter`
   Prompt template: `After a hard march, a companion needles you about a personal weakness they think they have spotted. Answer in a few lines that turn the jab back on them without breaking the working trust between you.`

Why these 4:

- `threat` stays because menace register is core to `Entreri`, `Zaknafein`, `Bruenor`, and `Jarlaxle`, and still produces recognizably different calm-vs-taunting-vs-gruff delivery.
- `reassurance` stays because it cleanly separates warm/protective voices from cold or instrumental ones; that makes it especially useful for `Drizzt ↔ Entreri` and `Jarlaxle ↔ Zaknafein`.
- `tactical_planning` stays because command style, sentence architecture, and what each speaker foregrounds are all load-bearing voice signals.
- `banter` stays because theatricality, flirted-with threat, dwarf teasing, and Drizzt-style restraint diverge sharply here.

Rejected archetypes:

- `grief` was dropped because several voices collapse toward the same solemn, low-heat register under grief, which raises overlap risk instead of separating them.
- `triumph` was dropped because it over-rewards generic martial exultation and makes too many outputs converge on battle-victory cadence.

## Voice Cards

The frozen voice-card artifact is [docs/evals/salvatore-distinctness-v1-voice-cards.json](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1-voice-cards.json).

Schema:

- Top-level keys are the lowercase card ids: `drizzt`, `bruenor`, `catti-brie`, `entreri`, `jarlaxle`, `zaknafein`.
- Each value contains:
  - `name`
  - `canonical_lines`
    - array of objects with `line`, `book`, `chapter`, `speaker`, `source_type`
    - `source_type` is `direct` when the line is spoken by the target character in the Icewind Dale trilogy bundle
    - `source_type` is `nearest_match` when the trilogy bundle has no direct dialogue for the target character
  - `tics`
  - `avoid`

Bundle constraint:

- `Drizzt`, `Bruenor`, `Catti-brie`, and `Entreri` use direct trilogy dialogue.
- `Jarlaxle` and `Zaknafein` do **not** appear as speaking characters in the Icewind Dale trilogy bundle on disk. Their cards are therefore frozen as explicitly flagged nearest-match proxies sourced from the closest in-bundle approximation scenes.
- `Jarlaxle` proxies draw from `Pook` and `Malchor` scenes because the bundle's closest match to his later-book register is cultured, amused, leverage-heavy performance.
- `Zaknafein` proxies draw from `Drizzt`'s drow-ethos confession and teaching cadence because the bundle's closest match to his later-book register is disciplined, clipped, drow-coded moral severity.

This is a known limitation, not a hidden one. The eval stays usable because the constraint is frozen and disclosed up front.

## Rotation Presets

Each character has 5 frozen canonical lines in the voice-card JSON. Each preset is a reproducible 3-line subset, matching the v4 training/runtime shape of `up to 3 exampleLines`.

Preset sweeps:

- Sweep `A`: use every character's `preset-a`
- Sweep `B`: use every character's `preset-b`
- Sweep `C`: use every character's `preset-c`

All three sweeps must be reported. No cherry-picking the best subset.

| Character | `preset-a` | `preset-b` | `preset-c` |
|---|---|---|---|
| `Drizzt` | lines `1,2,3` only; exclude `4,5` | lines `1,4,5` only; exclude `2,3` | lines `2,4,5` only; exclude `1,3` |
| `Bruenor` | lines `1,2,3` only; exclude `4,5` | lines `1,4,5` only; exclude `2,3` | lines `2,4,5` only; exclude `1,3` |
| `Catti-brie` | lines `1,2,3` only; exclude `4,5` | lines `1,4,5` only; exclude `2,3` | lines `2,4,5` only; exclude `1,3` |
| `Entreri` | lines `1,2,3` only; exclude `4,5` | lines `1,4,5` only; exclude `2,3` | lines `2,4,5` only; exclude `1,3` |
| `Jarlaxle` | lines `1,2,3` only; exclude `4,5` | lines `1,4,5` only; exclude `2,3` | lines `2,4,5` only; exclude `1,3` |
| `Zaknafein` | lines `1,2,3` only; exclude `4,5` | lines `1,4,5` only; exclude `2,3` | lines `2,4,5` only; exclude `1,3` |

Total frozen rotation configurations: `6 characters × 3 presets = 18`.

## Judge

Frozen judge model: `gpt-5.4` (OpenAI)

Why `gpt-5.4`:

- The judge must be named up front because `docs/decisions.md` records model-dependent distinctness outcomes in the archetype-pass POC: `Sonnet+profile 55%`, `LoRA 33%`, `DeepSeek 8%`. Judge identity is therefore load-bearing, not a runtime convenience.
- `deepseek-chat` is disqualified for this eval because the v4 training path pulls its `exampleLines` from `novels/salvatore-icewind-dale/analysis/dialogue-extract.jsonl`, and that file was produced by `deepseek-chat`.
- The Salvatore v3/v4 formatter path does not use `gpt-5.4` as a label source. The audited local sources for v4 point to:
  - `scripts/finetune/format-salvatore-v4-sft.py`
  - `novels/salvatore-icewind-dale/analysis/dialogue-extract.jsonl`
  - `scripts/finetune/archetype-poc/*`
- The clean circularity check is therefore: `gpt-5.4` is named here, and it does not appear in the v3/v4 Salvatore training-data build path that seeded the frozen `exampleLines` surface.

## Pairwise Protocol

For each of the 3 hard pairs and each of the 4 beat archetypes:

1. Generate one output per character from the same beat prompt.
2. Apply the arm being tested:
   - fixed adapter / fixed voice-card subset
   - or rotated adapter / rotated subset
3. Shuffle the two outputs into anonymous `Output A` and `Output B`.
4. Show the judge:
   - the two anonymized outputs
   - both intended voice cards
   - the pair label only as an unordered set of target identities
5. Judge returns one assignment:
   - `Output A -> character X`
   - `Output B -> character Y`

Scoring:

- A pairwise judgment is either fully right or fully swapped.
- Exact-assignment score per judgment is therefore either:
  - `2` if the assignment is correct
  - `0` if the assignment is wrong
- Per sweep total range: `0` to `24`
- Per anchor pair range across 4 beats: `0/4` to `4/4` pairwise calls, or `0` to `8` assignment cells

Required report breakdown:

- total exact-assignment cells per sweep
- per-pair results:
  - `Drizzt ↔ Entreri`
  - `Bruenor ↔ Catti-brie`
  - `Jarlaxle ↔ Zaknafein`
- per-beat confusion matrix
- three-sweep summary:
  - `min`
  - `max`
  - `mean`

## Variance Handling

- The eval is frozen as 3 preset sweeps, not 1 cherry-picked subset.
- Report `A`, `B`, and `C` separately, then report the three-sweep mean.
- Per-sweep min/max possible totals are `0/24` and `24/24`.
- Under random guessing, expected score is `12/24`.
- Because there are `12` binary pairwise calls per sweep, the random-guessing distribution is `2 × Binomial(12, 0.5)`.
- Random-guessing `95%` band is approximately `6/24` to `18/24`.

Interpretation:

- Scores in the low teens are near the random-noise floor.
- Gains should be judged against the same frozen judge, the same frozen beat pool, and all 3 preset sweeps.

## Ship / Iterate / Kill

These thresholds are the distinctness-axis gate for the follow-on charter and are defined on the **three-sweep mean** relative to fixed `salvatore-1988-v4`.

- **Ship conditioning-first**
  - rotated conditioning adds `>=4/24` exact-assignment cells over fixed v4
  - and every hard pair reaches at least `3/4` correct pairwise calls in at least `2` of the `3` sweeps
- **Iterate conditioning**
  - rotated conditioning adds more than `2/24` but less than `4/24`
  - or it clears `>=4/24` on the mean but at least one hard pair misses the `3/4` floor in `2` or more sweeps
- **Kill conditioning-first / reopen corpus question**
  - rotated conditioning adds `<=2/24`
  - or a hard pair lands at `<=1/4` in the majority of sweeps

## What This Eval Does Not Measure

- voice retention
  - retention stays on `salvatore-original-v1` plus held-out validation
- corpus-leak rate
  - leak remains a separate adapter / prompt-control problem
- on-plan adherence
  - this eval is voice separation only

## Freeze Rule

- This document is frozen at `status: frozen-2026-04-18`.
- Any methodological change requires a new artifact name and version, starting at `salvatore-distinctness-v2`.
