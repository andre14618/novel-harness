# Iteration Improvement Pathway

## Current Baseline

```
No baseline set yet — run benchmark with new 3-dimension judging system to establish.
```

## Scoring Dimensions (3, scored /30 total)

1. **Show/Tell** — models default to exposition, narrator statements about feelings
2. **Dialogue** — sparse, generic voices, characters sound the same
3. **Sensory** — abstract descriptions, not grounded in setting

Dropped from judging (handled by deterministic validation):
- **Beat Adherence** — keyword coverage check in `src/validation.ts`
- **Voice Consistency** — overlaps with Show/Tell in single-chapter benchmark; meaningful only across full novel

## Improvement Levers

### Layer 1: Writer Agent Prompt (`src/agents/writer/prompt.md`)
- Reword existing craft rules for specificity
- Do NOT add new rules — reword or restructure existing ones
- Prompt is currently 21 lines; keep it under 25
- Test: `bun benchmark/run.ts`

### Layer 2: Context Assembly (`src/agents/writer/context.ts`)
- **Highest-impact change identified by diagnostic:** interleave character speech patterns with scene beats instead of listing separately
- Move craft reminders before scene beats, not after everything
- Restructure context order: chapter header → craft reminders → scene blocks (beat + characters + speech patterns) → world rules → previous chapters
- Test: `bun benchmark/run.ts`

### Layer 3: Planning Plotter (`src/agents/planning-plotter/prompt.md`)
- Beat quality determines writer output quality
- More specific beats → better prose (diagnostic confirmed)
- Require beats to specify dialogue moments and physical actions
- Test: full harness run (`bun src/index.ts --auto`), then benchmark the output

### Layer 4: Model Selection (`models/roles.ts`)
- Change model for any agent individually
- Test different models for writer vs extractors vs validators
- Use `bun benchmark/calibrate.ts` to evaluate new judge models
- Test: benchmark with changed model assignment

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
1. Run /diagnose in Claude Code to analyze latest benchmark
2. Pick ONE change (single variable)
3. Edit the relevant file (prompt.md, context.ts, roles.ts, or config.ts)
4. Run: bun benchmark/run.ts
5. Check delta vs baseline
6. If improved: commit with scores, run --save-baseline
7. If flat/worse: revert, try the next suggestion
```

### Commit format
```
[agent:writer] Description of what changed

benchmark: 18.5/30 (+-2.1) S:5.8 D:6.0 X:6.7
delta: +1.4 vs baseline | 5 seeds x 3 runs
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
- **Judge consistency** — `bun benchmark/calibrate.ts` tests this (consistency metric)
- **Seed diversity** — verify no seed consistently scores >5 points above/below others
- **Judge discrimination** — `bun benchmark/calibrate.ts` tests this (WEAK < MID < STRONG)

## Provider Strategy

| Use case | Provider | Model | Notes |
|----------|----------|-------|-------|
| Iteration (all agents) | Groq | Qwen3 32B | Fast, cheap, current default |
| Quality runs | Cerebras | Qwen3 235B | Higher cost, test if quality improves |
| Benchmark judges | OpenRouter | Gemini 3 Flash | 100% discrimination, cheapest |
| Benchmark judges | Groq | Qwen3 32B | 100% discrimination, fast |
| Diagnostic | Claude Code | /diagnose | In-conversation, no API cost |

See `models/registry.ts` for full model catalog with pricing and specs.

## Next Steps (prioritized)

1. Run `bun benchmark/run.ts --save-baseline` to establish new 3-dimension baseline
2. Apply diagnostic suggestion: restructure writer context to interleave beats with character data
3. Benchmark, save new baseline if improved
4. Test cheaper models for extractors/validators (GPT-OSS 20B, Llama 4 Scout)
5. Add 2 more seeds for better genre coverage
6. Test Cerebras 235B baseline for quality ceiling comparison
