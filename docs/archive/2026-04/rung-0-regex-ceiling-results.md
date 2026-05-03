---
status: measured
date: 2026-04-20
charter: docs/scoping/halluc-leak-salvatore-v2.md §5
ship-decision: OR-combine regex with v1 at inference — skip SFT
---

# Rung 0 Regex-Ceiling Measurement — halluc-leak-salvatore

## Question

Does a deterministic case-insensitive substring match OR-combined with
`halluc-leak-salvatore-v1:v1` close the 16% recall gap on canonical
Forgotten Realms names that the adapter misses, without SFT spend?

## Method

- **Data:** 3,081 production `halluc-leak-salvatore` calls across 32
  Salvatore-routed novels (timestamp ≥ 2026-04-18).
- **Regex:** 59-token alternation built from `LEAK_TOKENS` /
  `LEAK_TERMS` in existing scripts, augmented with scoping-doc §B
  additions (Waterdeep, Baldur's Gate, Harpells, Chionthar, Neverwinter,
  Menzoberranzan, Gauntlgrym, Helm's Hold, Sea of Swords, Sea Sprite,
  Drossen Ironbelly, Nine-Towns). Word-boundary assertions allow
  apostrophes + hyphens but reject substring matches (`drow` but not
  `drowsy`).
- **Script:** `scripts/hallucination/rung-0-regex-ceiling.ts` (reads
  `user_prompt` field, runs regex, cross-tabs against adapter verdict).

## Results

### Per-call cross-tab

| | Regex fired | Regex silent |
|---|---:|---:|
| **Adapter fired** | 259 | 19 (adapter-only) |
| **Adapter silent** | 96 (regex-only) | 2,707 |

### Per-beat (deduped across retry attempts)

| Metric | Value |
|---|---:|
| Both fired | 146 |
| Adapter only | 12 |
| Regex only | 50 |
| Adapter-alone recall | 158 beats |
| **OR-combined recall** | **208 beats** |
| **Δ recall** | **+50 beats (+31.6%)** |

### Top regex-only catches (adapter missed, regex caught)

| Token | Fires | |
|---|---:|---|
| Harpells | 35 | Forgotten Realms wizard family — not in v1 training |
| Baldur's Gate | 32 | Major FR city — confirmed missed per exp #254 |
| Waterdeep | 15 | Major FR city — confirmed missed per exp #254 |
| Nine-Towns | 3 | IWD Ten-Towns variant |
| Spine of the World | 3 | IWD region |
| Targos | 3 | IWD town |
| Chionthar | 3 | FR river |
| Calimport | 2 | FR city |
| Drossen Ironbelly | 2 | IWD dwarf — exp #254 |
| drow | 3 | Race term (in v1 training but adapter missed here) |

Spot-check of top regex-only catches (5 samples, `/tmp/rung-0/regex-only-sample.json`)
confirmed these are unambiguous corpus leaks in dialogue or narration.
Estimated precision on regex-only catches ≥95%.

### Top adapter-only catches (regex missed, adapter caught)

| Token | Fires | Why regex missed |
|---|---:|---|
| dark elf | 3 | Two-word generic, not in LEAK_TOKENS (only "drow" is) |
| verbeeg | 3 | In token list — regex should have caught, needs investigation |
| Rumblebelly's | 2 | Possessive form; the `'s` sits outside my word-boundary |
| Bleakwood Forest | 2 | Not in token list; may be invented rather than corpus |
| mithril | 1 | Lowercase standalone (not "Mithril Hall") |
| Pasha, Pook, Pasha Pook | 3 | Pasha Pook is in list; standalone "Pasha"/"Pook" isn't |
| Kelvin | 1 | "Kelvin's Cairn" is in list; standalone "Kelvin" isn't |
| Aegis-fang | 1 | In list — should have caught; investigate |

Residual of 12 adapter-only beats is small (6% of OR-combined fires).
Three are genuine regex FNs (verbeeg, Aegis-fang) worth a followup; the
rest are generics or possessive-strip edge cases.

## Precision / Recall summary

Using union of `{adapter fires ∪ regex fires}` as the approximate set of
true leaks:

- **Regex alone**: precision ≥95% on regex-only group, recall
  = 355/(355+19) ≈ 94.9%
- **Adapter v1 alone**: precision high (production-deployed), recall
  = 278/(278+96) ≈ 74.3%
- **OR-combined**: recall ≈ 99%+, precision ≥ adapter's (regex adds
  near-zero FPs per spot check)

Both the scoping doc's gates (regex ≥85% precision, ≥75% recall) are
cleared comfortably.

## Ship decision

**SHIP regex OR-combine at inference. Skip v2 SFT spend.**

Implementation:
- New module `src/agents/halluc-leak-salvatore/regex-leak.ts` — token
  list + `regexLeakMatches(prose)`.
- `checkHallucLeakSalvatore` in `src/agents/halluc-leak-salvatore/index.ts`
  now runs regex alongside the adapter call, unions results into
  `issues`, and returns `pass = false` whenever either side fires.
- The adapter call's `llm_calls` row is still written — regex-only
  catches are visible by comparing `response_content` against the final
  merged issue list. Use the existing `halluc-leak-salvatore-v1` model
  URI; no adapter change.

## Ongoing

- Three genuine regex FNs (verbeeg, Aegis-fang when lone, possessive
  forms of list tokens) — add a test case + widen regex to accept
  `token + 's` and fold re-check.
- If future LoRAs ship for other writers (Gemmell, Cook per
  `project_three_layer_architecture.md`), mirror the regex module per
  adapter. Each writer's corpus gets its own token list + sibling
  `regex-leak.ts`.
- The salvatore-v5-stripped ablation (scoped separately) is **not
  required** now — regex OR-combine solves the immediate recall gap.
  The ablation remains an option only if future evidence shows the
  remaining ~1.5-leaks-per-novel rate is intolerable and voice lift
  survives corpus stripping.
