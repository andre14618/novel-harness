---
status: active
updated: 2026-04-29
---

# Stage 6 LLM-Judge Rubric — Sonnet / Codex Subagent Path

The Stage 6 calibration pipeline (per `docs/charters/corpus-structural-decomposition-v1.md`) replaces R6's single-human-rater gold protocol with an automated LLM judge. The default judge is **DeepSeek V4 Pro** via `bun scripts/corpus/llm-judge.ts` — capability-gradient independence over the V4 Flash extractor, but **same model family**.

For premium semantic judgment — cross-family independence, ambiguous-row arbitration, or final pre-decision validation — route a sample subset through Sonnet (Claude) or Codex (GPT-5.5) via subagent. This document is the rubric to hand the subagent so its labels are schema-compatible with `compute-calibration.ts`.

## When to use which judge

| Judge | Family | Path | When to use |
|---|---|---|---|
| **V4 Pro** | DeepSeek | `bun scripts/corpus/llm-judge.ts --judge V4 Pro` (default) | Default. Cheap (~$0.05–0.20 for 50 rows). Capability-gradient independence over V4 Flash extractor. |
| **Sonnet** | Anthropic | Spawn via `Agent` tool with this rubric | Premium ground-truth proxy. Cross-family. ~10–20 rows max per session. Use for ambiguous-row arbitration or final pre-decision validation. |
| **Codex** | OpenAI (gpt-5.5) | Spawn via `Agent(subagent_type: "codex:codex-rescue")` | Cross-family. Strong reasoning. Use as a third-judge tiebreaker when V4 Pro and Sonnet disagree on the same row, or for adjudicator-drift sanity check. |

**Combination protocol (recommended):** V4 Pro auto-judges all 30–50 rows; sample 10 ambiguous-quartile rows by V4 Pro confidence and re-judge them via Sonnet; Codex breaks ties when V4 Pro and Sonnet disagree.

## Subagent invocation pattern (Sonnet)

```
Agent({
  subagent_type: "general-purpose",
  description: "Sonnet structural-judge labels",
  prompt: <built from this template + the prompts.jsonl content>,
})
```

The subagent prompt MUST include:

1. **The labeling rubric (verbatim)** for the relevant dimension — see "Rubric for value-charge" or "Rubric for promise" below. Use the EXACT system prompt from the extractor at `src/agents/structure-value-charge/value-charge-system.md` or `src/agents/structure-promise/promise-open-system.md` so the judge labels by the same schema as the extractor.

2. **The prompts payload** — the relevant rows from `novels/<novel>/structure-gold/<book>/<dim>-prompts.jsonl`. Hand over JSON, not raw file paths — the subagent's working dir may differ.

3. **Output requirements** — the subagent MUST emit ONE JSON object per input prompt, in JSONL form, matching the `<dim>-gold.jsonl` shape the calibration script expects:

   - `value-charge-gold.jsonl`:
     ```json
     {"sample_id": "<from-prompt>", "scene_id": "<from-prompt>", "output": {"valueIn": "+|-|0", "valueOut": "+|-|0", "lifeValue": "<enum>", "polarity": "+|-|0", "confidence": <0-1>, "evidence_quote": "<verbatim>", "abstain_reason": null|"<short>"}}
     ```
   - `promise-gold.jsonl`:
     ```json
     {"sample_id": "<UUID>", "promise_text": "<≤200char>", "opened_chapter_label": "<raw>", "opened_chapter_index": <int>, "closed_chapter_label": "<raw>|null", "closed_chapter_index": <int>|null, "payoff_quality": "<enum>", "confidence": <0-1>}
     ```

4. **Contamination guard** — the subagent MUST NOT see the V4 Flash extractor's output for any row. Only the source prose / chapter beats from the prompt file are admissible context. The whole point of an independent judge is that it labels fresh.

5. **Schema compliance** — all enum values verbatim from the extractor system prompt. evidence_quote MUST be a substring of the source prose. promise_id (for promises) MUST be unique within the judge's output list.

## Rubric for value-charge

Quote `src/agents/structure-value-charge/value-charge-system.md` verbatim into the subagent prompt. The prompt input is the per-scene `scene_text`; the subagent emits the full schema. Cap output at 1024 tokens per row (matches the extractor's value-charge-judge maxTokens).

## Rubric for promise

Quote `src/agents/structure-promise/promise-open-system.md` for the open-pass and `src/agents/structure-promise/promise-close-system.md` for the close-pass. The subagent runs both passes for each chapter range it sees, then merges via `promise_id`.

For Sonnet/Codex specifically: a single subagent session may not have enough context to run the 2-pass on the full book in one shot (50K+ input). Either:
- (a) Run the full book in one subagent invocation if context allows
- (b) Run open-pass on the full book, then a separate close-pass invocation given the open-pass list

## Cross-judge agreement metrics

When BOTH V4 Pro and Sonnet (and optionally Codex) label the same rows, `compute-calibration.ts` can be extended to compute pairwise agreement (cf. R7 §7 once charter R7 is reviewed). For now, the simplest cross-judge sanity check is:

```bash
# Round 1 — V4 Pro auto-judges all rows
bun scripts/corpus/llm-judge.ts --novel=salvatore-icewind-dale --book=crystal_shard --dim=value-charge

# Round 2 — manually run Sonnet via subagent on 10-20 rows, save to
# structure-gold/crystal_shard/value-charge-sonnet.jsonl

# Round 3 — diff:
diff <(jq -c '.sample_id + " " + .output.polarity' < value-charge-gold.jsonl) \
     <(jq -c '.sample_id + " " + .output.polarity' < value-charge-sonnet.jsonl)
```

If V4 Pro and Sonnet disagree on > 20% of rows, V4 Pro's gold is suspect and Sonnet's labels should replace it for the calibration pass. The threshold is a placeholder pending R7 calibration.

## Anti-patterns

- **Do NOT use the same V4 Flash model for both extractor and judge.** Same-family same-config is a contamination pattern; the judge would simply mirror the extractor's biases.
- **Do NOT share extractor outputs with the judge subagent.** Even via partial leakage (e.g. "the extractor said polarity=−, your call?"). The judge must label fresh.
- **Do NOT skip the prompt-file shape.** `compute-calibration.ts` expects `<dim>-gold.jsonl` in a specific shape; freeform Sonnet output that doesn't match will fail the calibration pass silently.

## Linked context

- `docs/charters/corpus-structural-decomposition-v1.md` — Stage 6 charter (R7 pending)
- `scripts/corpus/llm-judge.ts` — V4 Pro auto-judge driver
- `scripts/corpus/compute-calibration.ts` — gold-consuming verdict computer
- `src/agents/structure-{value-charge,promise}/` — extractor agents (judge re-uses prompts/schemas)
