# `salvatore-distinctness-v1` arm configs

Schema for `scripts/evals/run-salvatore-distinctness-v1.ts` arm files:

```json
{
  "label": "v4-rotation",
  "adapter": "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4",
  "preset": "preset-a",
  "conditioning": "rotation",
  "notes": "optional free-form note"
}
```

Field meanings:

- `label`: report label for the arm.
- `adapter`: model target. This runner supports W&B artifact URIs and plain model ids such as `anthropic/claude-sonnet-4.6`.
- `preset`: one frozen sweep id from `docs/evals/salvatore-distinctness-v1.md`: `preset-a`, `preset-b`, or `preset-c`.
- `conditioning`:
  - `fixed`: use the chosen `preset` on every generation call (applies to `canonical_lines`; `tics`/`avoid` render in full).
  - `rotation`: rotate `canonical_lines` subsets deterministically across `preset-a -> preset-b -> preset-c` on successive generation calls, starting from `preset`. `tics`/`avoid` render in full. Isolates the example-line contribution (charter H1).
  - `profile-rotation`: rotate `tics`/`avoid` subsets across the same preset cycle starting from `preset`, while holding `canonical_lines` FIXED at `preset-a`. Isolates the profile-field contribution (charter H2).
  - `profile-only`: omit example lines and render only the profile/tics/avoid surface at the chosen `preset`.
- `notes`: optional operator note stored in the experiment config.

Shipped arm files:

- `v3.json`: v3 baseline, fixed subset.
- `v4-fixed.json`: v4 fixed-conditioning baseline.
- `v4-rotation.json`: v4 example-line rotation arm (charter H1).
- `v4-profile-rotation.json`: v4 profile-field rotation arm (charter H2).
- `sonnet-profile.json`: Sonnet ceiling arm with profile-only conditioning (no exampleLines).
