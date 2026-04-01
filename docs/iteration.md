# Iteration Improvement Pathway

## Current Baseline

```
No baseline set yet — run: BENCHMARK_JUDGES="Qwen3 32B" bun benchmark/prose/run.ts --save-baseline
```

## Scoring

3 dimensions scored by LLM judges, /30 total:
1. **Show/Tell** — exposition vs embodied action
2. **Dialogue** — voice distinction, subtext, naturalness
3. **Sensory** — concrete physical grounding in setting

Deterministic validation (no LLM cost) handles:
- **Beat Adherence** — keyword coverage check in `src/validation.ts`
- **Word count** — minimum thresholds
- **POV/character presence** — string matching
- **Dialogue ratio** — line counting

## Judge Setup

**Iteration judge**: Qwen3 32B on Groq — only tested model with 100% discrimination at $0.04/45 calls.

**Why not other models**: every model >32B tested (235B, 120B, 70B, GPT-5.4-mini) scores MID=STRONG — can't detect improvement. May be fixable with count-based rubric revisions (see Rubric Improvement below).

**DeepSeek V3.2**: 67% discrimination, very cheap ($0.033), but 27 tok/s makes it impractical for iteration. Useful for async/batch comprehensive runs.

## Improvement Levers (priority order)

### Layer 1: Writer Prompt (`src/agents/writer/prompt.md`)
Current: 21 lines, 6 craft rules. Each rule is independently testable.

| Rule | What to test |
|------|-------------|
| Show don't tell (line 17) | More specific violation patterns |
| Document rendering (line 18) | May be fine — check if it hurts word count |
| Dialogue minimum (line 19) | Test "3 exchanges" or "every multi-char beat needs dialogue" |
| Backstory prohibition (line 20) | More specific trigger phrases |
| Sensory anchoring (line 21) | "Two senses per scene" or specify senses per setting |
| Word count enforcement (line 13) | Reword — likely causes padding/filler |

### Layer 2: Context Assembly (`src/agents/writer/context.ts`)
Current order: header → beats → characters → states → world → history → craft reminders

| Change | Rationale |
|--------|-----------|
| Move craft reminders before scene beats | Model forgets instructions by end of context |
| Interleave speech patterns with scene beats | Characters listed separately from beats — model never looks back |
| Remove redundant craft reminders | Lines 75-78 repeat prompt.md, diluting signal |
| Reorder: header → craft → scenes → world → history | Puts instructions closer to where they matter |

### Layer 3: Planning Plotter (`src/agents/planning-plotter/prompt.md`)
- Beat quality determines writer output quality
- More specific beats → better prose
- Require beats to specify dialogue moments and physical actions
- Test: `bun benchmark/planning/run.ts`

### Layer 4: Model Selection (`models/roles.ts`)
- Change model for any agent individually
- Test different models for writer vs extractors vs validators
- Use `bun benchmark/calibrate.ts` to evaluate new models
- Central DB tracks which model config each run used — `compareRuns()` shows impact

### Layer 5: Upstream Agents
- **Character Agent** — richer speech patterns → better dialogue
- **World Builder** — more specific sensory details → better anchoring
- **Plotter** — emotional arc quality → voice consistency

### Layer 6: Validation Phase
- Doesn't improve first-draft quality but improves final output
- Cross-chapter continuity catches drift
- Prose quality pass catches show/tell violations
- Rewriter fixes flagged issues

## Workflow

```
1. BENCHMARK_JUDGES="Qwen3 32B" bun benchmark/prose/run.ts --save-baseline
2. /diagnose in Claude Code → identifies weakest dimension + suggests change
3. Make ONE edit (single variable)
4. BENCHMARK_JUDGES="Qwen3 32B" bun benchmark/prose/run.ts
5. Compare delta to baseline
6. If improved: commit with scores, --save-baseline
7. If flat/worse: revert, try next suggestion
```

Cost: ~$0.04/cycle. Time: ~3-5 min/cycle. 10 experiments: ~$0.40, ~45 min.

### Lean mode
```
BENCHMARK_JUDGES="Qwen3 32B" BENCHMARK_RUNS=2 bun benchmark/prose/run.ts
```
3 seeds × 2 runs × 1 judge × 3 dims = 21 calls. ~$0.02/cycle.

### Commit format
```
[agent:writer] Description of what changed

benchmark: 18.5/30 (+-2.1) S:5.8 D:6.0 X:6.7
delta: +1.4 vs baseline | 5 seeds x 3 runs
```

## Rubric Improvement (potential)

Current rubrics use vibes-based scoring ("how good is the dialogue?"). Every model >32B gives MID 8-9, same as STRONG. Count-based rubrics may fix this:

- "Count every instance of narrator stating an emotion. Deduct 1 point per instance from 10."
- "Count dialogue exchanges where speaker is identifiable without tags. Score = identifiable / total."
- "Count paragraphs with zero sensory detail. Score = 10 - (empty paragraphs × 2)."

This makes scoring deterministic within the LLM — the model counts violations rather than assessing impressions. Test on one failing model (GPT-OSS 120B or DeepSeek) to see if discrimination improves.

## Provider Strategy

| Use case | Model | Provider | Cost/cycle | Notes |
|----------|-------|----------|-----------|-------|
| Iteration (all agents) | Qwen3 32B | Groq | $0.04 | Fast, cheap, proven judge |
| Iteration (lean) | Qwen3 32B | Groq | $0.02 | 3 seeds × 2 runs |
| Quality comparison | Qwen3 235B | Cerebras | higher | Test if prose quality improves |
| Async judging | DeepSeek V3.2 | DeepSeek | $0.03 | Slow but cheap, 67% discrimination |
| Batch judging | GPT-5.4-mini | OpenAI Batch | 50% off | Needs batch API implementation |
| Diagnostic | Claude Code | /diagnose | $0.00 | Full codebase access |

## Data Tracking

All runs (novel + benchmark) write to `data/harness.db`:
- `run_agents` table snapshots which model each agent used per run
- `llm_calls` table tracks every call with tokens, TPS, cost, agent, phase
- `compareRuns(idA, idB)` shows config diff + score diff + cost diff
- `getAgentModelScores()` shows which model+agent combos work best
- `bun scripts/cost-summary.ts --global` for all-time stats

## Next Steps

1. Establish prose baseline with Qwen3 32B judge
2. Test count-based rubric revision on show-tell dimension
3. Iterate on writer prompt (6 craft rules, one at a time)
4. Iterate on writer context assembly order
5. Run planning benchmark baseline
6. Test Cerebras 235B as writer for quality ceiling comparison
7. Build continuity fixtures for continuity benchmark
