You read the chapter-by-chapter beat sequence of a published novel and identify **promises** that the author makes to the reader.

This is a corpus-extraction task. Your output trains the harness's PromiseRegistry — a structural-imitation tool that helps the planner ensure plot threads opened in early chapters are paid off later.

## What a promise is

A promise is a setup that creates a reader expectation of future payoff. It's an instance of the author saying "watch this — it matters." Some examples:

- A character makes a vow ("I will find Catti-brie")
- A mystery is introduced ("Who killed Akar Kessell's master?")
- A goal is declared ("Drizzt must reach Mithril Hall by spring")
- A threat is established ("the Crystal Shard's wielder will return")
- A relationship gains an unresolved tension ("Bruenor and Wulfgar circle each other warily — something will break here")
- A latent capability is shown ("Drizzt's twin scimitars are far more dangerous than they look")

It is NOT a promise if:
- The expectation is satisfied within the same scene (no future-payoff component)
- It's atmospheric scene-setting with no specific future-arrow
- It's a generic genre cue without a story-specific commitment

## What you output

A JSON object: `{"promises": [<promise object>, ...]}`. Each promise has:

```json
{
  "promise_id": "<short stable string, e.g. p001 — must be unique within this list>",
  "promise_text": "<≤200 char description of what was promised>",
  "opened_chapter_label": "<verbatim chapter label from input — string, e.g. '10' or 'prelude' or 'epilogue'>",
  "opened_chapter_index": <integer canonical index from the input, e.g. 10 / -1 / 1000>,
  "hint_chapter_labels": ["<list of chapter labels where the promise is reinforced>"],
  "hint_chapter_indices": [<matching integer indices>],
  "evidence_quote_open": "<verbatim summary text from the opening beat that establishes the promise>",
  "confidence": <number 0-1>
}
```

## Hard rules

1. **Open-pass only.** Do NOT include closure information (closed_chapter, payoff_quality, evidence_quote_close). Those come in the second pass.
2. **chapter_label + chapter_index MUST match** what the input shows for the opening beat. Pull both verbatim from the input.
3. **promise_id MUST be unique** within your output list. Use stable short IDs like `p001`, `p002`, etc.
4. **promise_text** must be specific enough that two readers reading just `promise_text` agree on what's promised. Avoid vague claims like "something will happen."
5. **evidence_quote_open** must be a verbatim substring of the input — pulled from the opening-beat summary text.
6. **Confidence calibration**:
   - ≥ 0.9 — explicit commitment ("she vowed to ___"), no ambiguity
   - 0.7–0.9 — clear narrative arrow but the wording is implicit
   - 0.4–0.7 — the promise is inferred from setup; might be misread as atmosphere
   - < 0.4 — DO NOT EMIT; the promise is too speculative
7. **Aim for completeness.** Recall is the primary cost-function for this extractor (per the charter): missing a real promise is worse than emitting a borderline one. Err on the side of including a promise at confidence 0.5 rather than dropping it.
8. Output ONLY the JSON object. No prose, no fences, no commentary.
