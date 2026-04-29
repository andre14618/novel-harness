You are doing the **closure pass** on a list of promises previously identified in a published novel.

Given (1) the chapter-by-chapter beats of the novel and (2) a list of open promises with their opening chapters, decide for each promise:

- Is it paid off? Where (chapter)?
- Quality of payoff?
- Does the source text show the closure verbatim?

This is a corpus-extraction task; your output completes the per-promise row used downstream by the harness's PromiseRegistry.

## What you output

A JSON object: `{"closures": [<closure object>, ...]}`. ONE closure per input-promise (matching by `promise_id`). Each closure:

```json
{
  "promise_id": "<must match an input promise_id exactly>",
  "closed_chapter_label": "<verbatim chapter label, OR null if open at end of book>",
  "closed_chapter_index": <integer index, OR null>,
  "payoff_quality": "satisfied" | "partially_satisfied" | "unsatisfied" | "unclear",
  "evidence_quote_close": "<verbatim quote from the closing beat, OR null if no closure>",
  "confidence": <number 0-1>
}
```

## payoff_quality definitions

- `satisfied` — promise is directly resolved; the reader's expectation is met
- `partially_satisfied` — promise is touched but not fully resolved (e.g. side-character vow paid off in passing)
- `unsatisfied` — promise is broken (deliberately or accidentally); the reader's expectation is dashed
- `unclear` — closure happens but quality of resolution is ambiguous

If `closed_chapter_label` is null (promise still open at end of book), `payoff_quality` MUST be `unsatisfied` AND `evidence_quote_close` MUST be null. Open-at-end-of-book is VALID per the charter (series fiction normally has long arcs that span volumes); don't try to invent closure that isn't there.

## Hard rules

1. **EVERY input promise gets a closure entry** — never drop one. If you can't find closure, emit `closed_chapter_label: null, closed_chapter_index: null, payoff_quality: "unsatisfied", evidence_quote_close: null`.
2. **closed_chapter_index > opened_chapter_index** (open-after-close is a tagging error). The input gives you each promise's `opened_chapter_index`; closure must come after.
3. **closed_chapter_label + closed_chapter_index MUST match** the input's actual chapter label/index pair when non-null.
4. **evidence_quote_close** must be a verbatim substring of the input beat text when non-null.
5. **Confidence calibration**:
   - ≥ 0.9 — explicit closure verb ("she found him", "the curse was broken")
   - 0.7–0.9 — closure is shown but a reader might miss it
   - < 0.7 — closure is inferred; consider `unclear` payoff_quality
6. Output ONLY the JSON object. No prose, no fences.
