# Halluc-Ungrounded Oracle Rubric v1

Use this rubric to label `halluc-ungrounded` calibration cases. Judge only the
evidence surface named in the case. If a case asks for `checker_visible`, do not
credit evidence that only appeared in the writer prompt. If a case asks for
`writer_visible`, use the writer prompt/retry context as well.

## Question

Did the prose introduce a named entity, unique place, faction, institution,
artifact, date, or lore term that was not grounded in the adjudicated evidence
surface?

## Inputs

- `flagged_issues`: checker-reported entities and excerpts.
- `checker_visible_sources_ref`: DB reference for the checker prompt and
  `request_json.groundedSources`.
- `writer_visible_sources_ref`: DB reference for the writer prompt/retry context.
- `adjudicated_surface`: `checker_visible` or `writer_visible`.
- optional prose/context excerpts copied into the case.

## Output Fields

For each flagged issue, produce:

```json
{
  "entity": "...",
  "oracle_label": "true_hallucination",
  "expected_severity": "blocker",
  "grounding_source": "none",
  "evidence_quote": "...",
  "notes": "short reason"
}
```

Allowed `oracle_label` values:

- `true_hallucination`
- `grounded_in_visible_context`
- `reasonable_generic_inference`
- `alias_or_paraphrase_false_positive`
- `missing_evidence_surface`
- `checker_prompt_error`

Allowed `expected_severity` values:

- `blocker`
- `warning`
- `pass`

## Label Rules

### `true_hallucination`

Use when the entity is a named world commitment and no grounding exists in the
adjudicated evidence surface.

Default severity: `blocker`.

### `grounded_in_visible_context`

Use when the exact entity, a clear variant, or a directly named source appears in
the adjudicated evidence surface.

Default severity: `pass`.

### `reasonable_generic_inference`

Use when the checker flagged a generic descriptive term or local inference that
does not create durable world state.

Default severity: `pass`, or `warning` if the term might confuse later state.

### `alias_or_paraphrase_false_positive`

Use when the flagged entity is a possessive, title, surname, paraphrase, or clear
alias of grounded context.

Default severity: `pass`.

### `missing_evidence_surface`

Use when the writer-visible surface grounds the entity, but the checker-visible
surface does not. This is a context plumbing problem, not a writer hallucination.

Default severity: `warning` until the evidence surfaces are unified.

### `checker_prompt_error`

Use when the evidence is present and the checker still flags it because the
prompt/rubric underspecifies the edge case.

Default severity: `warning`; fix prompt before blocker use.

## Important Edge Cases

- A previous failed/retry draft is not checker-visible unless the checker prompt
  includes it.
- A city resource, institution, named district, artifact, species, disease,
  deity, or lore term is a named world commitment even if it appears only once.
- Generic locations such as `the ward`, `the hall`, or `the market` are not
  automatically named entities.
- Title plus grounded surname passes, for example `Magistrate Venn` if `Aldric
  Venn` is grounded.
- Possessives pass if the base name is grounded, for example `Venn's daughter` if
  `Aldric Venn` is grounded.
