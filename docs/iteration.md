# Iteration Improvement Pathway

## Current Baseline

```
benchmark: 25.9/50 (±3.4) S:4.3 D:4.7 V:5.6 B:5.9 X:5.5
Writer: Groq Qwen3 32B | 5 seeds × 3 runs | ~$0.05/benchmark
```

## Weakest Dimensions (priority order)

1. **Show/Tell: 4.3/10** — models default to exposition, narrator statements about feelings
2. **Dialogue: 4.7/10** — sparse, generic voices, characters sound the same
3. **Sensory: 5.5/10** — abstract descriptions, not grounded in setting
4. **Voice: 5.6/10** — POV narration is generic, not character-specific
5. **Beats: 5.9/10** — closest to adequate, scene structure is mostly followed

## Improvement Levers

### Layer 1: Writer Agent Prompt (`src/agents/writer/prompt.md`)
- Reword existing craft rules for specificity
- Do NOT add new rules — reword or restructure existing ones
- Prompt is currently 21 lines; keep it under 25
- Test: `BENCHMARK_PROVIDER=groq bun scripts/benchmark.ts`

### Layer 2: Context Assembly (`src/agents/writer/context.ts`)
- **Highest-impact change identified by diagnostic:** interleave character speech patterns with scene beats instead of listing separately
- Move craft reminders before scene beats, not after everything
- Restructure context order: chapter header → craft reminders → scene blocks (beat + characters + speech patterns) → world rules → previous chapters
- Test: same benchmark

### Layer 3: Planning Plotter (`src/agents/planning-plotter/prompt.md`)
- Beat quality determines writer output quality
- More specific beats → better prose (diagnostic confirmed)
- Require beats to specify dialogue moments and physical actions
- Test: full harness run (`bun src/index.ts --auto`), then benchmark the output

### Layer 4: Config Tuning (`src/agents/writer/config.ts`)
- Temperature: currently 0.8, diagnostic suggested 0.9 for voice distinctiveness
- maxTokens: 16384 (adequate)
- Provider: Groq 32B for iteration, Cerebras 235B for quality runs
- Test: benchmark with changed config

### Layer 5: Upstream Agents
- **Character Agent** — richer speech patterns lead to better dialogue
- **World Builder** — more specific sensory details in locations lead to better anchoring
- **Plotter** — emotional arc quality affects voice consistency
- Test: full harness run, compare chapter output

### Layer 6: Validation Phase
- Cross-chapter continuity catches drift
- Prose quality pass catches show/tell violations
- Rewriter fixes flagged issues
- These don't improve first-draft quality, but improve final output
- Test: run harness with and without validation, compare

## Improvement Workflow

```
1. Read diagnostic suggestions from last benchmark
2. Pick ONE change (single variable)
3. Edit the relevant file (prompt.md, context.ts, or config.ts)
4. Run: BENCHMARK_PROVIDER=groq bun scripts/benchmark.ts
5. Check delta vs baseline
6. If improved: commit with scores, run --save-baseline
7. If flat/worse: revert, try the next diagnostic suggestion
```

### Commit format
```
[agent:writer] Description of what changed

benchmark: 28.1/50 (±3.2) S:5.1 D:5.3 V:5.8 B:6.0 X:5.9
delta: +2.2 vs baseline | 5 seeds × 3 runs
```

## Testing Gaps to Address

### Agent-level tests needed
- **Writer context assembly** — verify context.ts produces correct structure with mock DB data
- **Planning plotter output** — verify beats contain dialogue cues and physical actions
- **Rewriter** — verify rewrites preserve word count within 20% and address flagged issues
- **Cross-chapter continuity** — verify it catches known contradictions in test data

### Pipeline tests needed
- **End-to-end with validation** — verify concept→planning→drafting→validation→done completes
- **Resume from each phase** — verify --resume works from concept, planning, drafting, validation
- **Multi-seed consistency** — verify harness handles all 5 seeds without failure
- **Provider failover** — verify retry logic works on 429/503 for all agents

### Benchmark tests needed
- **Judge consistency** — run same prose through judges twice, verify scores within ±2
- **Seed diversity** — verify no seed consistently scores >5 points above/below others (if so, the seed is too easy/hard)
- **Diagnostic quality** — verify diagnostic suggestions are actionable (manual review)

## Provider Strategy

| Use case | Provider | Model | Cost/novel |
|----------|----------|-------|------------|
| Prompt iteration | Groq | Qwen3 32B | $0.02 |
| Quality runs | Cerebras | Qwen3 235B-A22B | $0.04-0.10 |
| Benchmark judge | GPT-5.4-mini | gpt-5.4-mini | ~$0.002/call |
| Benchmark judge | Kimi K2 | kimi-k2-instruct | ~$0.009/call |
| Benchmark judge | Gemini 3 Flash | gemini-3-flash-preview | ~$0.002/call |
| Diagnostic | GPT-5.4 | gpt-5.4 | ~$0.03/call |

## Next Steps (prioritized)

1. Apply diagnostic suggestion #1: restructure writer context to interleave beats with character data
2. Apply diagnostic suggestion #2: reword the "full detailed scenes" instruction
3. Benchmark both changes, save new baseline if improved
4. Add 2 more seeds for better genre coverage (horror, romance?)
5. Build agent-level tests for writer context assembly
6. Test Cerebras 235B baseline for quality ceiling comparison
