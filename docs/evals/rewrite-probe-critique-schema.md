---
status: canonical-2026-04-21
eval: rewrite-capability-probe
---

# Rewrite-probe critique artifact format

This document defines the canonical JSONL format for pre-run critique
artifacts in the `rewrite-capability-probe` charter. A critique artifact is
generated once, committed to the repo before arm (b) runs, and read
deterministically by the probe runner so the experiment is reproducible.

## JSONL row schema

One row per beat. Each row is a complete critique for one V1 prose source.

```jsonl
{"pair_id": "<the same pair_id from triplets.json>", "v1_source_arm": "rotation|fixed|raw", "v1_prose": "<the V1 prose string>", "defects": [<QualityDefect objects>], "critique_text": "<rendered string passed to the writer>", "generated_by": "detector-v1", "generated_at": "<ISO8601>"}
```

### Field definitions

| Field | Type | Description |
|-------|------|-------------|
| `pair_id` | string | Must match the `pair_id` field in the corresponding triplets JSONL row. This is the join key between the critique artifact and the replay output. |
| `v1_source_arm` | `"rotation"` \| `"fixed"` \| `"raw"` | Which conditioning-floor arm produced the V1 prose. For the rewrite-probe, this is always `"rotation"` (the arm that exhibited the known failure modes in the conditioning-floor pilot). |
| `v1_prose` | string | The full prose string from the conditioning-floor pilot's `rotation.prose` field for this beat. Stored verbatim so the artifact is self-contained; callers do not need to re-read the triplets file. |
| `defects` | `QualityDefect[]` | Array of defect objects from `src/lint/quality-detectors.ts`. Each defect has the shape `{kind, severity, description, span?, metadata?}`. May be empty if no defects were detected (row still written so the artifact is complete). |
| `critique_text` | string | The rendered critique string that arm (b) passes to `buildRetryPrompt` as the `issues` array joined with newlines. This is the exact text that reaches the writer's prompt; storing it here allows auditors to inspect what the adapter actually saw without re-running the detector. |
| `generated_by` | string | Version tag of the detector that generated this row. Current value: `"detector-v1"`. Change this if the detector logic changes so rows from different runs can be distinguished. |
| `generated_at` | string | ISO 8601 timestamp of when the critique was generated. Used to verify that the artifact predates arm (b)'s LLM calls (reproducibility requirement). |

### `QualityDefect` object shape

Matches the TypeScript interface in `src/lint/quality-detectors.ts`:

```json
{
  "kind": "repetition" | "voice-collapse" | "underlength",
  "severity": "high" | "medium" | "low",
  "description": "<human-readable critique text for this defect>",
  "span": { "start": <char offset>, "end": <char offset> },
  "metadata": { ... }
}
```

`span` and `metadata` are optional. `metadata` contents vary by detector:
- `repetition`: `{gram, count, windowWords, n}`
- `underlength`: `{wordCount, minWords}`
- `voice-collapse`: detector-specific (implementation deferred)

## Selection criteria

Which beats get critiqued:

1. **Source:** the 20 pre-registered pair-builder beats from the conditioning-floor pilot (`output/evals/conditioning-floor-pairs-v1.jsonl`), using the `rotation` arm's prose from `output/evals/conditioning-floor-pilot-v1-triplets.json`.
2. **All 20 beats receive a row** in the critique artifact, even if `defects` is empty. This makes the artifact complete and avoids the need for callers to special-case missing beats.
3. **Beats with no defects** get `defects: []` and `critique_text: ""`. Arm (b) with an empty critique degrades to a no-op (matching the no-critique path of arm (a)), which is an acceptable edge case — the beat will still produce output, but it won't benefit from targeted guidance.

## Single-critique-per-beat rule

Each beat has exactly one critique row. The critique row represents the union
of all defects found by the sync detectors (`detectRepetition` +
`detectUnderlength`). Voice-collapse defects from `detectVoiceCollapse` are
also included IF the charter run invokes the stub's real implementation, but
the stub always returns `[]` so voice-collapse rows are absent in the initial
artifact.

There is NO deduplication or ranking of defects — all flagged defects are
included. If a beat has three repetition defects and one underlength defect,
the `defects` array has four entries and `critique_text` concatenates all
four `description` strings.

## `critique_text` rendering

`critique_text` is the exact string passed as the `issues` array to
`buildRetryPrompt`. It is the newline-joined list of defect descriptions:

```
<defect[0].description>
<defect[1].description>
...
```

When `defects` is empty, `critique_text` is `""` and `buildRetryPrompt`
returns the vanilla (no-critique) prompt unchanged (see the guard in
`src/agents/writer/retry-context.ts`).

## Reproducibility requirements

The critique artifact must be:

1. **Committed before arm (b) runs.** The file path is
   `output/evals/rewrite-probe-critiques.jsonl`. It must be a tracked git
   artifact (not in `.gitignore`), committed with a SHA that predates the
   first arm (b) LLM call logged in `llm_calls`. The `generated_at`
   timestamp provides a secondary check.
2. **Generated deterministically from a pinned input.** The V1 prose is read
   from the pinned triplets file (`conditioning-floor-pilot-v1-triplets.json`)
   with a specific `pair_id` → `rotation.prose` lookup. Detector parameters
   (`minCount`, `windowWords`, `minWords`) must be logged in `generated_by`
   or a companion metadata file if they differ from defaults.
3. **Not modified after arm (b) starts.** If a defect is found to be wrong
   after the run starts, it constitutes a protocol violation. The correct
   action is to abort the run, commit a corrected artifact, and restart from
   arm (b)'s first beat.

## How to regenerate from `llm_calls` data

If the triplets file is lost or the critique artifact needs to be rebuilt from
scratch, the steps are:

1. Query `llm_calls` for the conditioning-floor rotation-arm prose:
   ```sql
   SELECT beat_index, chapter, response_content
   FROM llm_calls
   WHERE novel_id = '<source-novel-id>'
     AND agent = 'conditioning-floor-replay'
     AND failed IS NOT TRUE
   ORDER BY chapter, beat_index, timestamp ASC
   ```
   The `beat_index` + `chapter` pair maps back to `pair_id` via the triplets JSONL.
2. For each row, call `detectSyncDefects(response_content)` from
   `src/lint/quality-detectors.ts` with default parameters.
3. Render `critique_text` as the newline-joined `description` strings.
4. Write the JSONL rows with `v1_source_arm: "rotation"` and
   `generated_by: "detector-v1"`.

If the `conditioning-floor-pilot-v1-triplets.json` file IS available, use
`rotation.prose` as the authoritative source (it is the exact bytes the
replay runner produced, not reconstructed from `response_content`).
